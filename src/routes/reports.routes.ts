import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { reportsController } from '../controllers/reports.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove } from '../middleware/requireRole'
import { ipWhitelist } from '../middleware/ipWhitelist'

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/summary', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Reports'],
      summary: 'High-level summary: total orders, users, and revenue',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            totalOrders: z.number(),
            totalUsers: z.number(),
            totalRevenue: z.string(),
          }),
        }),
      },
    },
    handler: reportsController.getSummary,
  })

  app.get('/orders/by-status', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Reports'],
      summary: 'Order count grouped by status',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({ status: z.string(), count: z.number() }),
          ),
        }),
      },
    },
    handler: reportsController.getOrdersByStatus,
  })

  app.get('/revenue', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Reports'],
      summary: 'Daily revenue breakdown over a date range (default: last 30 days)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              date: z.string(),
              total: z.string(),
              count: z.number(),
            }),
          ),
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: reportsController.getRevenueByPeriod,
  })
}
