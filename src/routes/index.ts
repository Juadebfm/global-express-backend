import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { usersRoutes } from './users.routes'
import { ordersRoutes } from './orders.routes'
import { paymentsRoutes } from './payments.routes'
import { uploadsRoutes } from './uploads.routes'
import { reportsRoutes } from './reports.routes'

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

  await app.register(usersRoutes, { prefix: '/api/v1/users' })
  await app.register(ordersRoutes, { prefix: '/api/v1/orders' })
  await app.register(paymentsRoutes, { prefix: '/api/v1/payments' })
  await app.register(uploadsRoutes, { prefix: '/api/v1/uploads' })
  await app.register(reportsRoutes, { prefix: '/api/v1/reports' })
}
