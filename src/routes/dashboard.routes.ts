import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { dashboardController } from '../controllers/dashboard.controller'
import { authenticate } from '../middleware/authenticate'

// Reusable change indicator schema — null means no prior-period baseline
const changeSchema = z
  .object({ value: z.number(), direction: z.enum(['up', 'down']) })
  .nullable()
  .describe('Period-over-period % change (last 30d vs prior 30d). null = no baseline.')

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── GET /dashboard/stats ─────────────────────────────────────────────────
  // KPI counts by status + financial summary + period-over-period % change.
  // Role-gated: customers see their own data; admin/staff/superadmin see global.

  app.get('/stats', {
    preHandler: [authenticate],
    schema: {
      tags: ['Dashboard'],
      summary: 'KPI stats — shipment counts + financial summary + % change',
      description: `Returns shipment counts by status, a financial figure, and period-over-period % change indicators.

**Customers** see only their own orders. The financial field is \`totalSpent\` (sum of their successful payments).

**Superadmin** sees global counts and the financial field \`revenueMtd\` (all-time revenue from successful payments).

**Admin / Staff** see global order counts but do **not** receive revenue figures.

**Change fields** (e.g. \`totalOrdersChange\`) compare the last 30 days against the prior 30 days.
Each change field is \`{ value: number, direction: "up" | "down" }\` or \`null\` when there is no prior-period baseline.

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
            totalOrdersChange: changeSchema,
            activeShipments: z.number(),
            activeShipmentsChange: changeSchema,
            pendingOrders: z.number(),
            pendingOrdersChange: changeSchema,
            deliveredToday: z.number(),
            deliveredTotal: z.number(),
            deliveredTotalChange: changeSchema,
            cancelled: z.number(),
            returned: z.number(),
            revenueMtd: z.string().optional().describe('Superadmin only — global platform revenue'),
            revenueMtdChange: changeSchema.optional().describe('Superadmin only'),
            totalSpent: z.string().optional().describe('Customer only — their own payment total'),
            totalSpentChange: changeSchema.optional().describe('Customer only'),
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

**shipmentType** is the transport mode for that destination group: \`air\` | \`ocean\` (or null if not set).

**Role gating**: customers see their own orders; admin/staff see all.`,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              destination: z.string().describe('Destination name'),
              shipmentType: z.enum(['air', 'ocean']).nullable().describe('Transport mode'),
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

  // ─── GET /dashboard ───────────────────────────────────────────────────────
  // Combined endpoint — returns stats + trends + activeDeliveries in one call.

  const statsSchema = z.object({
    totalOrders: z.number(),
    totalOrdersChange: changeSchema,
    activeShipments: z.number(),
    activeShipmentsChange: changeSchema,
    pendingOrders: z.number(),
    pendingOrdersChange: changeSchema,
    deliveredToday: z.number(),
    deliveredTotal: z.number(),
    deliveredTotalChange: changeSchema,
    cancelled: z.number(),
    returned: z.number(),
    revenueMtd: z.string().optional(),
    revenueMtdChange: changeSchema.optional(),
    totalSpent: z.string().optional(),
    totalSpentChange: changeSchema.optional(),
  })

  const trendsSchema = z.array(
    z.object({
      month: z.number(),
      deliveredWeight: z.string(),
      activeWeight: z.string(),
    }),
  )

  const activeDeliveriesSchema = z.array(
    z.object({
      destination: z.string(),
      shipmentType: z.enum(['air', 'ocean']).nullable(),
      activeCount: z.number(),
      nextEta: z.string().nullable(),
      status: z.enum(['on_time', 'delayed', 'unknown']),
    }),
  )

  app.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Dashboard'],
      summary: 'Full dashboard — stats + trends + active deliveries in one call',
      description: `Returns all dashboard data in a single request. Runs all 3 queries in parallel.

**Role gating** (same rules as the individual endpoints):
- Customers see their own data (\`totalSpent\` instead of \`revenueMtd\`)
- Admin / Staff / Superadmin see global data

**Query params:**
- \`year\` — year for the trends graph (defaults to current year)`,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        year: z.coerce.number().int().min(2020).max(2100).optional().describe('Year for trends graph (defaults to current year)'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            stats: statsSchema,
            trends: trendsSchema,
            activeDeliveries: activeDeliveriesSchema,
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: dashboardController.getAll,
  })
}
