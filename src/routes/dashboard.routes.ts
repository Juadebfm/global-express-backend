import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { dashboardController } from '../controllers/dashboard.controller'
import { authenticate } from '../middleware/authenticate'

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── GET /dashboard/stats ─────────────────────────────────────────────────
  // KPI counts by status + financial summary.
  // Role-gated: customers see their own data; admin/staff/superadmin see global.

  app.get('/stats', {
    preHandler: [authenticate],
    schema: {
      tags: ['Dashboard'],
      summary: 'KPI stats — shipment counts + financial summary',
      description: `Returns shipment counts by status and a financial figure.

**Customers** see only their own orders. The financial field is \`totalSpent\` (sum of their successful payments).

**Admin / Staff / Superadmin** see global counts across all orders. The financial field is \`revenueMtd\` (all-time revenue from successful payments).

**Response fields:**
- \`totalOrders\` — all orders (customer: theirs only)
- \`activeShipments\` — in_transit + out_for_delivery
- \`pendingOrders\` — pending + picked_up
- \`deliveredToday\` — orders whose status changed to delivered today
- \`deliveredTotal\` — all-time delivered count
- \`cancelled\`, \`returned\` — terminal states
- \`revenueMtd\` — admin/staff only (global revenue)
- \`totalSpent\` — customer only (their own payments)`,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            totalOrders: z.number(),
            activeShipments: z.number(),
            pendingOrders: z.number(),
            deliveredToday: z.number(),
            deliveredTotal: z.number(),
            cancelled: z.number(),
            returned: z.number(),
            revenueMtd: z.string().optional().describe('Admin/staff only — global revenue'),
            totalSpent: z.string().optional().describe('Customer only — their own payment total'),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: dashboardController.getStats,
  })

  // ─── GET /dashboard/trends ────────────────────────────────────────────────
  // Monthly weight aggregation for the shipment trends graph.

  app.get('/trends', {
    preHandler: [authenticate],
    schema: {
      tags: ['Dashboard'],
      summary: 'Shipment trends — monthly weight by status (graph data)',
      description: `Returns 12 data points (one per month) for the shipment trends chart.

- **Y axis**: total package weight in kg
- **X axis**: month (1 = Jan … 12 = Dec)
- **deliveredWeight**: sum of weight for orders with status \`delivered\` in that month
- **activeWeight**: sum of weight for orders in non-terminal statuses (pending, picked_up, in_transit, out_for_delivery)

**Query params:**
- \`year\` — defaults to current year

**Role gating**: customers see their own orders; admin/staff see all.`,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        year: z.coerce.number().int().min(2020).max(2100).optional().describe('Year (defaults to current year)'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              month: z.number().describe('Month number (1–12)'),
              deliveredWeight: z.string().describe('Total weight of delivered orders (kg)'),
              activeWeight: z.string().describe('Total weight of active orders (kg)'),
            }),
          ),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: dashboardController.getTrends,
  })

  // ─── GET /dashboard/active-deliveries ────────────────────────────────────
  // Active orders grouped by destination for the Delivery Schedule panel.

  app.get('/active-deliveries', {
    preHandler: [authenticate],
    schema: {
      tags: ['Dashboard'],
      summary: 'Active deliveries grouped by destination (Delivery Schedule panel)',
      description: `Returns active (non-terminal) orders grouped by destination for the Delivery Schedule panel.

**Status logic:**
- \`on_time\` — ETA is set and in the future
- \`delayed\` — ETA is set and has already passed
- \`unknown\` — no ETA set on the orders

**shipmentType** is the transport mode for that destination group: \`air\` | \`ocean\` | \`road\` (or null if not set).

**Role gating**: customers see their own orders; admin/staff see all.`,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              destination: z.string().describe('Destination name'),
              shipmentType: z.enum(['air', 'ocean', 'road']).nullable().describe('Transport mode'),
              activeCount: z.number().describe('Number of active shipments to this destination'),
              nextEta: z.string().nullable().describe('Earliest ETA among active shipments (ISO 8601)'),
              status: z.enum(['on_time', 'delayed', 'unknown']).describe('Derived delivery status'),
            }),
          ),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: dashboardController.getActiveDeliveries,
  })
}
