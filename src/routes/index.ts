import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { db } from '../config/db'
import { authRoutes } from './auth.routes'
import { usersRoutes } from './users.routes'
import { ordersRoutes } from './orders.routes'
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
import { publicRoutes } from './public.routes'
import { galleryRoutes } from './gallery.routes'
import { batchesRoutes } from './batches.routes'
import { supplierRoutes } from './supplier.routes'

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ─── Health (liveness) — always 200 if the process is up ─────────────────
  // For load-balancer liveness probes. Use /readiness for dependency checks.
  server.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Liveness probe — always 200 if the server process is responsive',
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

  // ─── Readiness — verifies downstream dependencies are reachable ──────────
  // Returns 503 when the DB is unreachable so the load balancer can route
  // around a degraded instance. Keep this lightweight (single `SELECT 1`).
  server.get('/readiness', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness probe — 200 when DB is reachable, 503 otherwise',
      response: {
        200: z.object({
          status: z.string(),
          timestamp: z.string(),
          checks: z.object({
            database: z.literal('ok'),
          }),
        }),
        503: z.object({
          status: z.string(),
          timestamp: z.string(),
          checks: z.object({
            database: z.string(),
          }),
        }),
      },
    },
    handler: async (request, reply) => {
      try {
        await db.execute(sql`select 1`)
        reply.send({
          status: 'ready',
          timestamp: new Date().toISOString(),
          checks: { database: 'ok' as const },
        })
      } catch (err) {
        request.log.error({ err }, 'Readiness check failed: DB unreachable')
        reply.code(503).send({
          status: 'not_ready',
          timestamp: new Date().toISOString(),
          checks: { database: 'unreachable' },
        })
      }
    },
  })

  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(usersRoutes, { prefix: '/api/v1/users' })
  await app.register(ordersRoutes, { prefix: '/api/v1/orders' })
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
  await app.register(publicRoutes, { prefix: '/api/v1/public' })
  await app.register(galleryRoutes, { prefix: '/api/v1/gallery' })
  await app.register(batchesRoutes, { prefix: '/api/v1/batches' })
  await app.register(supplierRoutes, { prefix: '/api/v1/supplier' })
}
