import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { packageImages } from '../../drizzle/schema'
import { env } from '../config/env'

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

export class UploadsService {
  /**
   * Generates a presigned PUT URL so the client can upload directly to R2.
   * Pass either orderId (solo order) or bulkItemId (bulk shipment item).
   */
  async generatePresignedUrl(params: {
    orderId?: string
    bulkItemId?: string
    contentType: string
  }): Promise<PresignedUrlResult> {
    const { orderId, bulkItemId, contentType } = params
    const fileExtension = contentType.split('/')[1] ?? 'bin'
    const folder = orderId ? `orders/${orderId}` : `bulk-items/${bulkItemId}`
    const r2Key = `${folder}/${randomUUID()}.${fileExtension}`
    const expiresInSeconds = 300 // 5 minutes

    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: r2Key,
      ContentType: contentType,
    })

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: expiresInSeconds })
    const publicUrl = `${env.R2_PUBLIC_URL}/${r2Key}`

    return { uploadUrl, r2Key, publicUrl, expiresInSeconds }
  }

  /**
   * Called by the client after a successful R2 upload to persist the image record.
   * Pass either orderId or bulkItemId.
   */
  async confirmUpload(params: {
    orderId?: string
    bulkItemId?: string
    r2Key: string
    uploadedBy: string
  }) {
    const publicUrl = `${env.R2_PUBLIC_URL}/${params.r2Key}`

    const [image] = await db
      .insert(packageImages)
      .values({
        orderId: params.orderId ?? null,
        bulkItemId: params.bulkItemId ?? null,
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

  async getBulkItemImages(bulkItemId: string) {
    return db
      .select()
      .from(packageImages)
      .where(eq(packageImages.bulkItemId, bulkItemId))
      .orderBy(packageImages.createdAt)
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
