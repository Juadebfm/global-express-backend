import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { uploadsController } from '../controllers/uploads.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove, requireAdminOrAbove } from '../middleware/requireRole'

const imageResponseSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  r2Key: z.string(),
  r2Url: z.string(),
  uploadedBy: z.string().uuid(),
  createdAt: z.string(),
})

export async function uploadsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/presign', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Uploads'],
      summary: 'Get a presigned PUT URL to upload a package image directly to R2',
      description:
        'Files go directly from the client to Cloudflare R2 — never through this server.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        orderId: z.string().uuid(),
        contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            uploadUrl: z.string().url(),
            r2Key: z.string(),
            publicUrl: z.string().url(),
            expiresInSeconds: z.number(),
          }),
        }),
      },
    },
    handler: uploadsController.generatePresignedUrl,
  })

  app.post('/confirm', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Uploads'],
      summary: 'Confirm a completed R2 upload and save the image record',
      security: [{ bearerAuth: [] }],
      body: z.object({
        orderId: z.string().uuid(),
        r2Key: z.string().min(1),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: imageResponseSchema }),
      },
    },
    handler: uploadsController.confirmUpload,
  })

  app.get('/orders/:orderId/images', {
    preHandler: [authenticate],
    schema: {
      tags: ['Uploads'],
      summary: 'Get all images for an order',
      security: [{ bearerAuth: [] }],
      params: z.object({ orderId: z.string().uuid() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(imageResponseSchema),
        }),
      },
    },
    handler: uploadsController.getOrderImages,
  })

  app.delete('/images/:imageId', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Uploads'],
      summary: 'Delete a package image (admin+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ imageId: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: uploadsController.deleteImage,
  })
}
