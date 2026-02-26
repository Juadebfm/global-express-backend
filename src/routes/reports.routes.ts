import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { reportsController } from '../controllers/reports.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/requireRole'
import { ipWhitelist } from '../middleware/ipWhitelist'

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/summary', {
    preHandler: [authenticate, requireSuperAdmin, ipWhitelist],
    schema: {
      tags: ['Reports'],
      summary: 'Dashboard summary — total orders, users, and revenue (superadmin)',
      description: `Returns a high-level summary suitable for the admin dashboard.

- **totalOrders** — count of all non-deleted orders
- **totalUsers** — count of all active customer accounts
- **totalRevenue** — cumulative revenue from \`successful\` payments (in major currency units, e.g. "125000.00")

**Example response:**
\`\`\`json
{
  "success": true,
  "data": {
    "totalOrders": 342,
    "totalUsers": 198,
    "totalRevenue": "4750000.00"
  }
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            totalOrders: z.number().describe('Total number of orders'),
            totalUsers: z.number().describe('Total number of customer accounts'),
            totalRevenue: z.string().describe('Cumulative revenue from successful payments (major units)'),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: reportsController.getSummary,
  })

  app.get('/orders/by-status', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Reports'],
      summary: 'Order count grouped by status',
      description: `Returns the number of orders in each status. Useful for building status distribution charts on the dashboard.

**Example response:**
\`\`\`json
{
  "success": true,
  "data": [
    { "status": "pending",            "count": 45 },
    { "status": "in_transit",         "count": 123 },
    { "status": "delivered",          "count": 210 },
    { "status": "cancelled",          "count": 12 }
  ]
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              status: z.string().describe('Order status value'),
              count: z.number().describe('Number of orders with this status'),
            }),
          ),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: reportsController.getOrdersByStatus,
  })

  app.get('/revenue', {
    preHandler: [authenticate, requireSuperAdmin, ipWhitelist],
    schema: {
      tags: ['Reports'],
      summary: 'Daily revenue breakdown over a date range (superadmin)',
      description: `Returns daily revenue totals for a given date range. Defaults to the **last 30 days** if no dates are provided.

Only counts revenue from payments with status \`successful\`.

**Query parameters:**
- \`from\` — start date in ISO 8601 format (e.g. \`2024-01-01T00:00:00Z\`)
- \`to\` — end date in ISO 8601 format (e.g. \`2024-01-31T23:59:59Z\`)

**Example:** \`GET /api/v1/reports/revenue?from=2024-01-01T00:00:00Z&to=2024-01-31T00:00:00Z\`

**Example response:**
\`\`\`json
{
  "success": true,
  "data": [
    { "date": "2024-01-01", "total": "125000.00", "count": 3 },
    { "date": "2024-01-02", "total": "87500.00",  "count": 2 },
    { "date": "2024-01-03", "total": "0.00",       "count": 0 }
  ]
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        from: z.string().datetime().optional().describe('Start date — ISO 8601 (e.g. 2024-01-01T00:00:00Z). Defaults to 30 days ago.'),
        to: z.string().datetime().optional().describe('End date — ISO 8601 (e.g. 2024-01-31T23:59:59Z). Defaults to now.'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              date: z.string().describe('Date in YYYY-MM-DD format'),
              total: z.string().describe('Total revenue for the day (major units, e.g. "125000.00")'),
              count: z.number().describe('Number of successful payments on this day'),
            }),
          ),
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: reportsController.getRevenueByPeriod,
  })
}
