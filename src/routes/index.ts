import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { authRoutes } from './auth.routes'
import { usersRoutes } from './users.routes'
import { ordersRoutes } from './orders.routes'
import { bulkOrdersRoutes } from './bulk-orders.routes'
import { paymentsRoutes } from './payments.routes'
import { uploadsRoutes } from './uploads.routes'
import { reportsRoutes } from './reports.routes'
import { webhooksRoutes } from './webhooks.routes'
import { internalRoutes } from './internal.routes'
import { dashboardRoutes } from './dashboard.routes'
import { notificationsRoutes } from './notifications.routes'
import { shipmentsRoutes } from './shipments.routes'
import { teamRoutes } from './team.routes'
import { adminRoutes } from './admin.routes'
import { settingsRoutes } from './settings.routes'
import { supportRoutes } from './support.routes'

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // Health check — no auth required
  server.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Server health check',
      response: {
        200: z.object({
          status: z.string(),
          timestamp: z.string(),
        }),
      },
    },
    handler: async (_request, reply) => {
      reply.send({ status: 'ok', timestamp: new Date().toISOString() })
    },
  })

  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(usersRoutes, { prefix: '/api/v1/users' })
  await app.register(ordersRoutes, { prefix: '/api/v1/orders' })
  await app.register(bulkOrdersRoutes, { prefix: '/api/v1/bulk-orders' })
  await app.register(paymentsRoutes, { prefix: '/api/v1/payments' })
  await app.register(uploadsRoutes, { prefix: '/api/v1/uploads' })
  await app.register(reportsRoutes, { prefix: '/api/v1/reports' })
  await app.register(webhooksRoutes, { prefix: '/webhooks' })
  await app.register(internalRoutes, { prefix: '/api/v1/internal' })
  await app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' })
  await app.register(notificationsRoutes, { prefix: '/api/v1/notifications' })
  await app.register(shipmentsRoutes, { prefix: '/api/v1/shipments' })
  await app.register(teamRoutes, { prefix: '/api/v1/team' })
  await app.register(adminRoutes, { prefix: '/api/v1/admin' })
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' })
  await app.register(supportRoutes, { prefix: '/api/v1/support' })
}
