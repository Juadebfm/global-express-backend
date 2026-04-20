import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { packageImages, orders } from '../../drizzle/schema'
import { env } from '../config/env'
import { UserRole } from '../types/enums'

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
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
    scope: 'orders' | 'invoices'
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
