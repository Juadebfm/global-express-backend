import { createHash } from 'crypto'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { fileScans, type FileScanStatus } from '../../drizzle/schema'
import { env } from '../config/env'
import { logSecurityEvent } from '../utils/security-events'

/**
 * AV scanning of uploaded files via VirusTotal (ASVS V12.4.1).
 *
 *   https://docs.virustotal.com/reference/files-overview
 *
 * Flow per uploaded file:
 *   1. `scheduleScan(...)` inserts a `pending` row in `file_scans` and
 *      fire-and-forgets `runScan(...)`.
 *   2. `runScan(...)` downloads the object from R2, computes its SHA-256,
 *      and queries VirusTotal by hash.
 *   3. If found: updates the row to `clean` or `malicious` based on the
 *      report's `malicious + suspicious` counts.
 *   4. If not found OR if VIRUSTOTAL_API_KEY is unset: marks the row as
 *      `skipped` so staff UI can see it never went through full AV
 *      (admins can then manually trigger a re-scan or accept the risk).
 *
 * **Staff UI MUST gate file access on `status === 'clean'`.**
 */

const VT_API = 'https://www.virustotal.com/api/v3'
const ENABLED = Boolean(env.VIRUSTOTAL_API_KEY)
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024 // 32MB — VT free tier limit
const MAX_DETECTIONS_FOR_CLEAN = 0 // 0 detections to be considered clean

const vtClient = axios.create({
  baseURL: VT_API,
  timeout: 15_000,
  headers: ENABLED ? { 'x-apikey': env.VIRUSTOTAL_API_KEY ?? '' } : {},
})
axiosRetry(vtClient, { retries: 2, retryDelay: axiosRetry.exponentialDelay })

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

interface VirusTotalFileReport {
  data?: {
    attributes?: {
      last_analysis_stats?: {
        malicious?: number
        suspicious?: number
        harmless?: number
        undetected?: number
      }
      meaningful_name?: string
      type_description?: string
    }
  }
}

export interface ScheduleScanInput {
  r2Key: string
  scope: string
  scopeId?: string
}

export const avScanService = {
  isEnabled(): boolean {
    return ENABLED
  },

  /**
   * Insert a `pending` row and fire-and-forget the actual scan. Called from
   * upload confirm endpoints; safe to call multiple times for the same r2Key —
   * unique constraint catches duplicates.
   */
  async scheduleScan(input: ScheduleScanInput): Promise<void> {
    await db
      .insert(fileScans)
      .values({
        r2Key: input.r2Key,
        scope: input.scope,
        scopeId: input.scopeId ?? null,
        status: ENABLED ? 'pending' : 'skipped',
      })
      .onConflictDoNothing()

    if (!ENABLED) return

    void this.runScan(input.r2Key).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[av-scan] runScan failed', { r2Key: input.r2Key, err })
    })
  },

  /**
   * Download the object, hash it, query VirusTotal, persist the verdict.
   *
   * Exposed publicly so staff can trigger a re-scan from the admin UI.
   */
  async runScan(r2Key: string): Promise<FileScanStatus> {
    if (!ENABLED) {
      await this.updateStatus(r2Key, 'skipped', null, null)
      return 'skipped'
    }

    let sha256: string
    let bytes: number
    try {
      const { sha256: hash, size } = await this.downloadAndHash(r2Key)
      sha256 = hash
      bytes = size
    } catch (err) {
      await this.updateStatus(r2Key, 'error', null, {
        stage: 'download',
        error: (err as Error).message,
      })
      return 'error'
    }

    let response: VirusTotalFileReport
    try {
      const res = await vtClient.get<VirusTotalFileReport>(`/files/${sha256}`)
      response = res.data
    } catch (err) {
      const axErr = err as { response?: { status?: number } }
      if (axErr.response?.status === 404) {
        // VT has never seen this hash — mark skipped (true "unknown").
        await db
          .update(fileScans)
          .set({
            sha256,
            bytes,
            status: 'skipped',
            scanProvider: 'virustotal',
            scannedAt: new Date(),
            scanResponse: { result: 'unknown_hash' },
            updatedAt: new Date(),
          })
          .where(eq(fileScans.r2Key, r2Key))
        return 'skipped'
      }
      await this.updateStatus(r2Key, 'error', sha256, {
        stage: 'virustotal',
        error: (err as Error).message,
        bytes,
      })
      return 'error'
    }

    const stats = response.data?.attributes?.last_analysis_stats
    const malicious = stats?.malicious ?? 0
    const suspicious = stats?.suspicious ?? 0
    const verdict: FileScanStatus =
      malicious + suspicious > MAX_DETECTIONS_FOR_CLEAN ? 'malicious' : 'clean'

    await db
      .update(fileScans)
      .set({
        sha256,
        bytes,
        status: verdict,
        scanProvider: 'virustotal',
        scannedAt: new Date(),
        scanResponse: response,
        updatedAt: new Date(),
      })
      .where(eq(fileScans.r2Key, r2Key))

    if (verdict === 'malicious') {
      // Quarantine: delete from R2 so the file can't be re-served.
      try {
        await r2Client.send(
          new DeleteObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: r2Key,
          }),
        )
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[av-scan] quarantine delete failed', { r2Key, err })
      }
      logSecurityEvent({
        type: 'permission_denied', // closest existing event type
        metadata: {
          subtype: 'malicious_file_quarantined',
          r2Key,
          sha256,
          stats,
        },
      })
    }

    return verdict
  },

  async getStatus(r2Key: string): Promise<{ status: FileScanStatus; scannedAt: string | null } | null> {
    const [row] = await db
      .select({ status: fileScans.status, scannedAt: fileScans.scannedAt })
      .from(fileScans)
      .where(eq(fileScans.r2Key, r2Key))
      .limit(1)
    if (!row) return null
    return {
      status: row.status as FileScanStatus,
      scannedAt: row.scannedAt?.toISOString() ?? null,
    }
  },

  async downloadAndHash(r2Key: string): Promise<{ sha256: string; size: number }> {
    const res = await r2Client.send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: r2Key }),
    )
    const body = res.Body
    if (!body) throw new Error('Empty R2 body')

    const hash = createHash('sha256')
    let size = 0

    // The SDK returns a Node Readable stream in Node.js runtimes.
    const stream = body as AsyncIterable<Uint8Array>
    for await (const chunk of stream) {
      size += chunk.byteLength
      if (size > MAX_DOWNLOAD_BYTES) {
        throw new Error(`File exceeds AV scan size limit (${MAX_DOWNLOAD_BYTES} bytes)`)
      }
      hash.update(chunk)
    }

    return { sha256: hash.digest('hex'), size }
  },

  async updateStatus(
    r2Key: string,
    status: FileScanStatus,
    sha256: string | null,
    response: Record<string, unknown> | null,
  ): Promise<void> {
    await db
      .update(fileScans)
      .set({
        status,
        sha256,
        scanProvider: 'virustotal',
        scannedAt: new Date(),
        scanResponse: response,
        updatedAt: new Date(),
      })
      .where(eq(fileScans.r2Key, r2Key))
  },
}
