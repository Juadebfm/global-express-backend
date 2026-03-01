import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { reportsController } from '../controllers/reports.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/requireRole'

// ─── Shared schemas ──────────────────────────────────────────────────────────

const errorSchemas = {
  400: z.object({ success: z.literal(false), message: z.string() }),
  401: z.object({ success: z.literal(false), message: z.string() }),
  403: z.object({ success: z.literal(false), message: z.string() }),
}

const dateRangeQuerystring = z.object({
  from: z.string().datetime().optional().describe('Start date — ISO 8601. Defaults to 12 months ago.'),
  to: z.string().datetime().optional().describe('End date — ISO 8601. Defaults to now.'),
})

const dateRangeWithGroupBy = dateRangeQuerystring.extend({
  groupBy: z.enum(['day', 'week', 'month']).optional().describe('Grouping interval. Defaults to month.'),
})

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ── Summary (kept for backward compat) ──────────────────────────────────

  app.get('/summary', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Reports'],
      summary: 'High-level summary — total orders, users, and revenue (superadmin)',
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
        ...errorSchemas,
      },
    },
    handler: reportsController.getSummary,
  })

  // ── Orders by status (kept for backward compat) ─────────────────────────

  app.get('/orders/by-status', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Reports'],
      summary: 'Order count grouped by status (legacy — use /status-pipeline instead)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              status: z.string().nullable(),
              count: z.number(),
            }),
          ),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getOrdersByStatus,
  })

  // ── 1. Revenue Analytics (enhanced) ─────────────────────────────────────

  app.get('/revenue', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Reports'],
      summary: 'Revenue analytics with flexible grouping and period comparison (superadmin)',
      description: `Returns revenue data grouped by day, week, or month. Defaults to last 12 months grouped by month.

Set \`compareToLastPeriod=true\` to include a comparison with the equivalent prior period.`,
      security: [{ bearerAuth: [] }],
      querystring: dateRangeWithGroupBy.extend({
        compareToLastPeriod: z.enum(['true', 'false']).optional().describe('Compare to equivalent prior period. Defaults to false.'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            periods: z.array(z.object({
              period: z.string(),
              revenue: z.string(),
              paymentCount: z.number(),
              avgOrderValue: z.string(),
            })),
            totals: z.object({
              totalRevenue: z.string(),
              totalPayments: z.number(),
              avgOrderValue: z.string(),
            }),
            comparison: z.object({
              previousRevenue: z.string(),
              previousPayments: z.number(),
              revenueChange: z.object({
                value: z.number(),
                direction: z.enum(['up', 'down']),
              }).nullable(),
            }).optional(),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getRevenueAnalytics,
  })

  // ── 2. Shipment Volume ──────────────────────────────────────────────────

  app.get('/shipment-volume', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Reports'],
      summary: 'Shipment volume over time — air vs sea split',
      description: 'Returns order counts and weight totals grouped by period, split by transport mode (air/sea).',
      security: [{ bearerAuth: [] }],
      querystring: dateRangeWithGroupBy,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            periods: z.array(z.object({
              period: z.string(),
              total: z.number(),
              air: z.number(),
              sea: z.number(),
              totalWeight: z.string(),
              airWeight: z.string(),
              seaWeight: z.string(),
            })),
            totals: z.object({
              totalShipments: z.number(),
              airShipments: z.number(),
              seaShipments: z.number(),
              totalWeight: z.string(),
              airWeight: z.string(),
              seaWeight: z.string(),
            }),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getShipmentVolume,
  })

  // ── 3. Top Customers ────────────────────────────────────────────────────

  app.get('/top-customers', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Reports'],
      summary: 'Top customers ranked by orders, weight, or revenue',
      description: `Returns top N customers sorted by the chosen metric. Revenue field is only visible to superadmins.`,
      security: [{ bearerAuth: [] }],
      querystring: dateRangeQuerystring.extend({
        sortBy: z.enum(['orderCount', 'totalWeight', 'revenue']).optional().describe('Sort metric. Defaults to orderCount.'),
        limit: z.coerce.number().int().min(5).max(50).optional().describe('Number of results (5–50). Defaults to 10.'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(z.object({
            customerId: z.string(),
            displayName: z.string().nullable(),
            email: z.string().nullable(),
            orderCount: z.number(),
            totalWeight: z.string(),
            avgWeight: z.string(),
            revenue: z.string().optional(),
          })),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getTopCustomers,
  })

  // ── 4. Delivery Performance ─────────────────────────────────────────────

  app.get('/delivery-performance', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Reports'],
      summary: 'Average delivery times — overall, by transport mode, and by month',
      description: 'Measures time from order creation to PICKED_UP_COMPLETED status. Only includes delivered orders.',
      security: [{ bearerAuth: [] }],
      querystring: dateRangeQuerystring,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            overall: z.object({
              avgDaysToDeliver: z.string().nullable(),
              medianDaysToDeliver: z.string().nullable(),
              totalDelivered: z.number(),
            }),
            byTransportMode: z.array(z.object({
              transportMode: z.string(),
              avgDaysToDeliver: z.string().nullable(),
              medianDaysToDeliver: z.string().nullable(),
              totalDelivered: z.number(),
              minDays: z.string().nullable(),
              maxDays: z.string().nullable(),
            })),
            byMonth: z.array(z.object({
              period: z.string(),
              avgDaysToDeliver: z.string().nullable(),
              totalDelivered: z.number(),
            })),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getDeliveryPerformance,
  })

  // ── 5. Status Pipeline ──────────────────────────────────────────────────

  app.get('/status-pipeline', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Reports'],
      summary: 'Order status pipeline — counts, labels, phases, and percentages',
      description: 'Real-time snapshot of orders at each V2 status stage. Optionally filter by transport mode.',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        transportMode: z.enum(['air', 'sea']).optional().describe('Filter by transport mode.'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            pipeline: z.array(z.object({
              status: z.string(),
              label: z.string(),
              count: z.number(),
              percentage: z.string(),
              phase: z.enum(['pre_transit', 'air_transit', 'sea_transit', 'lagos_processing', 'terminal']),
            })),
            totalActive: z.number(),
            totalAll: z.number(),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getStatusPipeline,
  })

  // ── 6. Payment Breakdown ────────────────────────────────────────────────

  app.get('/payment-breakdown', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Reports'],
      summary: 'Payment method breakdown — types, success rates, and collection status (superadmin)',
      description: 'Analyzes payments by type (online/transfer/cash), by status, and order payment collection status.',
      security: [{ bearerAuth: [] }],
      querystring: dateRangeQuerystring,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            byType: z.array(z.object({
              paymentType: z.string(),
              total: z.number(),
              successful: z.number(),
              failed: z.number(),
              pending: z.number(),
              abandoned: z.number(),
              successRate: z.string(),
              totalAmount: z.string(),
            })),
            byStatus: z.array(z.object({
              status: z.string(),
              count: z.number(),
              amount: z.string(),
            })),
            collectionStatus: z.array(z.object({
              status: z.string(),
              orderCount: z.number(),
              totalCharge: z.string(),
            })),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getPaymentBreakdown,
  })

  // ── 7. Shipment Comparison (air vs sea) ─────────────────────────────────

  app.get('/shipment-comparison', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Reports'],
      summary: 'Air vs sea head-to-head comparison',
      description: 'Compares air and sea shipments by volume, weight, delivery time, and completion rate. Revenue fields visible to superadmins only.',
      security: [{ bearerAuth: [] }],
      querystring: dateRangeQuerystring,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            comparison: z.array(z.object({
              transportMode: z.string(),
              orderCount: z.number(),
              totalWeight: z.string(),
              avgWeight: z.string(),
              totalRevenue: z.string().optional(),
              avgRevenue: z.string().optional(),
              completedCount: z.number(),
              cancelledCount: z.number(),
              completionRate: z.string(),
              avgDeliveryDays: z.string().nullable(),
            })),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: reportsController.getShipmentComparison,
  })
}
