import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { batchDocuments, dispatchBatches, packageImages, orders } from '../../drizzle/schema'
import { env } from '../config/env'
import { UserRole } from '../types/enums'
import { avScanService } from './av-scan.service'

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
  // AWS SDK v3 ≥ 3.750 adds CRC32 checksums by default (WHEN_SUPPORTED).
  // R2 rejects PUT uploads when the presigned-URL checksum (CRC32 of empty body)
  // doesn't match the actual file. Set WHEN_REQUIRED to suppress this header.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

export interface PresignedUrlResult {
  uploadUrl: string
  r2Key: string
  publicUrl: string
  expiresInSeconds: number
}

function isExternalViewerRole(role: UserRole): boolean {
  return role === UserRole.USER || role === UserRole.SUPPLIER
}

export class UploadsService {
  private async generateScopedPresignedUrl(params: {
    scope: 'orders' | 'invoices' | 'payments' | 'gallery-claims' | 'gallery-items' | 'batches'
    scopeId: string
    contentType: string
    originalFileName?: string
  }): Promise<PresignedUrlResult> {
    const extFromContentType = params.contentType.split('/')[1] ?? 'bin'
    const normalizedExt = extFromContentType.toLowerCase()
    const safeName = params.originalFileName
      ? params.originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_')
      : `${randomUUID()}.${normalizedExt}`
    const fileName = safeName.endsWith(`.${normalizedExt}`) ? safeName : `${safeName}.${normalizedExt}`
    const r2Key = `${params.scope}/${params.scopeId}/${randomUUID()}-${fileName}`
    const expiresInSeconds = 300 // 5 minutes

    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: r2Key,
      ContentType: params.contentType,
    })

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: expiresInSeconds })
    const publicUrl = `${env.R2_PUBLIC_URL}/${r2Key}`

    return { uploadUrl, r2Key, publicUrl, expiresInSeconds }
  }

  /**
   * Generates a presigned PUT URL so the client can upload directly to R2.
   */
  async generatePresignedUrl(params: {
    orderId: string
    contentType: string
  }): Promise<PresignedUrlResult> {
    const { orderId, contentType } = params
    return this.generateScopedPresignedUrl({
      scope: 'orders',
      scopeId: orderId,
      contentType,
    })
  }

  async generateInvoiceAttachmentPresignedUrl(params: {
    invoiceId: string
    contentType: string
    originalFileName?: string
  }): Promise<PresignedUrlResult> {
    return this.generateScopedPresignedUrl({
      scope: 'invoices',
      scopeId: params.invoiceId,
      contentType: params.contentType,
      originalFileName: params.originalFileName,
    })
  }

  async generatePaymentReceiptPresignedUrl(params: {
    orderId: string
    contentType: string
    originalFileName?: string
  }): Promise<PresignedUrlResult> {
    return this.generateScopedPresignedUrl({
      scope: 'payments',
      scopeId: params.orderId,
      contentType: params.contentType,
      originalFileName: params.originalFileName,
    })
  }

  async generateGalleryClaimProofPresignedUrl(params: {
    uploadToken: string
    contentType: string
    originalFileName?: string
  }): Promise<PresignedUrlResult> {
    return this.generateScopedPresignedUrl({
      scope: 'gallery-claims',
      scopeId: params.uploadToken,
      contentType: params.contentType,
      originalFileName: params.originalFileName,
    })
  }

  async generateBatchDocumentPresignedUrl(params: {
    batchId: string
    contentType: string
    originalFileName?: string
  }): Promise<PresignedUrlResult | null> {
    const [batch] = await db
      .select({ id: dispatchBatches.id })
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, params.batchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)
    if (!batch) return null

    return this.generateScopedPresignedUrl({
      scope: 'batches',
      scopeId: params.batchId,
      contentType: params.contentType,
      originalFileName: params.originalFileName,
    })
  }

  async confirmBatchDocumentUpload(params: {
    batchId: string
    r2Key: string
    documentType: 'mawb' | 'bill_of_lading' | 'container_photo' | 'vessel_photo' | 'other'
    fileName?: string
    uploadedBy: string
  }): Promise<{ doc: { id: string; batchId: string; documentType: string; fileUrl: string; fileName: string | null; uploadedBy: string; createdAt: string }; error?: never } | { error: 'batch_not_found' | 'invalid_r2_key'; doc?: never }> {
    const [batch] = await db
      .select({ id: dispatchBatches.id })
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, params.batchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)
    if (!batch) return { error: 'batch_not_found' }

    const expectedPrefix = `batches/${params.batchId}/`
    if (!params.r2Key.startsWith(expectedPrefix)) return { error: 'invalid_r2_key' }

    const publicUrl = `${env.R2_PUBLIC_URL}/${params.r2Key}`
    const [row] = await db
      .insert(batchDocuments)
      .values({
        batchId: params.batchId,
        documentType: params.documentType,
        fileUrl: publicUrl,
        fileName: params.fileName ?? null,
        uploadedBy: params.uploadedBy,
      })
      .returning()
    return { doc: { ...row, createdAt: row.createdAt.toISOString() } }
  }

  async listBatchDocuments(batchId: string): Promise<{ rows: { id: string; batchId: string; documentType: string; fileUrl: string; fileName: string | null; uploadedBy: string; createdAt: string }[]; error?: never } | { error: 'batch_not_found'; rows?: never }> {
    const [batch] = await db
      .select({ id: dispatchBatches.id })
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, batchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)
    if (!batch) return { error: 'batch_not_found' }

    const rows = await db
      .select()
      .from(batchDocuments)
      .where(eq(batchDocuments.batchId, batchId))
      .orderBy(batchDocuments.createdAt)
    return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) }
  }

  async generateGalleryItemMediaPresignedUrl(params: {
    uploadToken: string
    contentType: string
    originalFileName?: string
  }): Promise<PresignedUrlResult> {
    return this.generateScopedPresignedUrl({
      scope: 'gallery-items',
      scopeId: params.uploadToken,
      contentType: params.contentType,
      originalFileName: params.originalFileName,
    })
  }

  /**
   * Called by the client after a successful R2 upload to persist the image record.
   */
  async confirmUpload(params: {
    orderId: string
    r2Key: string
    uploadedBy: string
  }) {
    const publicUrl = `${env.R2_PUBLIC_URL}/${params.r2Key}`

    const [image] = await db
      .insert(packageImages)
      .values({
        orderId: params.orderId,
        r2Key: params.r2Key,
        r2Url: publicUrl,
        uploadedBy: params.uploadedBy,
      })
      .returning()

    // Fire-and-forget AV scan (V12.4.1). Staff UI must gate on scan status.
    void avScanService.scheduleScan({
      r2Key: params.r2Key,
      scope: 'orders/package-image',
      scopeId: params.orderId,
    })

    return image
  }

  async getOrderImages(orderId: string) {
    return db
      .select()
      .from(packageImages)
      .where(eq(packageImages.orderId, orderId))
      .orderBy(packageImages.createdAt)
  }

  async getOrderImagesForViewer(params: {
    orderId: string
    viewerId: string
    viewerRole: UserRole
  }) {
    const [order] = await db
      .select({ id: orders.id, senderId: orders.senderId })
      .from(orders)
      .where(and(eq(orders.id, params.orderId), isNull(orders.deletedAt)))
      .limit(1)

    if (!order) {
      return { status: 'not_found' as const }
    }

    if (isExternalViewerRole(params.viewerRole) && order.senderId !== params.viewerId) {
      return { status: 'forbidden' as const }
    }

    const images = await this.getOrderImages(params.orderId)
    return { status: 'ok' as const, images }
  }

  async deleteImage(imageId: string) {
    const [image] = await db
      .select()
      .from(packageImages)
      .where(eq(packageImages.id, imageId))
      .limit(1)

    if (!image) return null

    // Delete from R2
    await r2.send(
      new DeleteObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: image.r2Key,
      }),
    )

    // Remove DB record
    await db.delete(packageImages).where(eq(packageImages.id, imageId))

    return image
  }
}

export const uploadsService = new UploadsService()
