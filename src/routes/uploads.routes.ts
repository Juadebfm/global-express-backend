import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { uploadsController } from '../controllers/uploads.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove, requireAdminOrAbove } from '../middleware/requireRole'

const imageResponseSchema = z.object({
  id: z.string().uuid().describe('Image record UUID'),
  orderId: z.string().uuid().describe('UUID of the associated order'),
  r2Key: z.string().describe('Cloudflare R2 object key'),
  r2Url: z.string().describe('Public image URL'),
  uploadedBy: z.string().uuid().describe('UUID of the staff who uploaded the image'),
  createdAt: z.string(),
})

export async function uploadsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/presign', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Uploads'],
      summary: 'Get a presigned PUT URL to upload a package image directly to R2',
      description: `Generates a short-lived presigned PUT URL for uploading a package image **directly to Cloudflare R2** — the file never passes through this server.

**Upload flow:**
1. Call this endpoint to get a \`uploadUrl\` and \`r2Key\`
2. \`PUT\` the image file to \`uploadUrl\` from the client (set \`Content-Type\` header to match)
3. Call \`POST /api/v1/uploads/confirm\` with the \`r2Key\` to save the image record

**Example request body:**
\`\`\`json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "contentType": "image/jpeg"
}
\`\`\`

**Supported content types:** \`image/jpeg\` | \`image/jpg\` | \`image/png\` | \`image/webp\`

The presigned URL expires in **1 hour**.`,
      security: [{ bearerAuth: [] }],
      body: z.object({
        orderId: z.string().uuid().describe('UUID of the order this image belongs to'),
        contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']).describe('MIME type of the image file'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            uploadUrl: z.string().url().describe('Presigned PUT URL — upload the file here directly from the client'),
            r2Key: z.string().describe('R2 object key — pass this to /confirm after upload'),
            publicUrl: z.string().url().describe('Public URL where the image will be accessible after upload'),
            expiresInSeconds: z.number().describe('Seconds until the presigned URL expires (3600 = 1 hour)'),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: uploadsController.generatePresignedUrl,
  })

  app.post('/confirm', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Uploads'],
      summary: 'Confirm a completed R2 upload and save the image record',
      description: `After a successful direct upload to R2, call this endpoint to register the image in the database.

The \`r2Key\` must match the key returned by \`POST /api/v1/uploads/presign\`.

**Example request body:**
\`\`\`json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "r2Key": "orders/550e8400-e29b-41d4-a716-446655440000/1698765432-abc123.jpg"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        orderId: z.string().uuid().describe('UUID of the order this image belongs to'),
        r2Key: z.string().min(1).describe('R2 object key returned from /presign'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: imageResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: uploadsController.confirmUpload,
  })

  app.get('/orders/:orderId/images', {
    preHandler: [authenticate],
    schema: {
      tags: ['Uploads'],
      summary: 'Get all images for an order',
      description: 'Returns all package images attached to the given order. Customers can view images for their own orders; staff can view images for any order.',
      security: [{ bearerAuth: [] }],
      params: z.object({ orderId: z.string().uuid().describe('Order UUID') }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(imageResponseSchema),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: uploadsController.getOrderImages,
  })

  app.delete('/images/:imageId', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Uploads'],
      summary: 'Delete a package image (admin+)',
      description: 'Deletes the image record from the database and removes the file from Cloudflare R2. Admin role required.',
      security: [{ bearerAuth: [] }],
      params: z.object({ imageId: z.string().uuid().describe('Image record UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: uploadsController.deleteImage,
  })
}
