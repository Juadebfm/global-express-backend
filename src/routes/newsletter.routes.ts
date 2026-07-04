import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { errorResponseSchema } from '../utils/problem-details'
import { newsletterController } from '../controllers/newsletter.controller'
import { authenticate } from '../middleware/authenticate'
import { requireSuperAdmin } from '../middleware/requireRole'

const subscriberSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  isActive: z.boolean(),
  subscribedAt: z.string(),
})

export async function newsletterRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/subscribers', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Newsletter'],
      summary: 'List newsletter subscribers (superadmin)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        activeOnly: z.enum(['true', 'false']).optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(subscriberSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
    handler: newsletterController.listSubscribers,
  })

  // CSV export — bypasses Zod response schema since we return raw CSV
  app.get('/subscribers/export', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Newsletter'],
      summary: 'Export subscribers as CSV (superadmin)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        activeOnly: z.enum(['true', 'false']).optional(),
      }),
    },
    handler: newsletterController.exportCsv,
  })

  app.patch('/subscribers/:id/deactivate', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Newsletter'],
      summary: 'Deactivate a subscriber (superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: newsletterController.deactivateSubscriber,
  })

  app.delete('/subscribers/:id', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Newsletter'],
      summary: 'Hard-delete a subscriber — GDPR erasure (superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ deleted: z.literal(true) }) }),
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: newsletterController.deleteSubscriber,
  })
}
