import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { errorResponseSchema } from '../utils/problem-details'
import { batchesController } from '../controllers/batches.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/requireRole'

const errorSchemas = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  422: errorResponseSchema,
}

// Shared batch summary shape
const batchSchema = z.object({
  id: z.string(),
  masterTrackingNumber: z.string(),
  transportMode: z.string(),
  transportLabel: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  carrierName: z.string().nullable(),
  airlineTrackingNumber: z.string().nullable(),
  oceanTrackingNumber: z.string().nullable(),
  d2dTrackingNumber: z.string().nullable(),
  voyageOrFlightNumber: z.string().nullable(),
  estimatedDepartureAt: z.string().nullable(),
  estimatedArrivalAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Valid statuses that can be set on a closed batch (post-close movement)
const ALLOWED_BATCH_STATUSES = [
  'DISPATCHED_TO_ORIGIN_AIRPORT',
  'AT_ORIGIN_AIRPORT',
  'BOARDED_ON_FLIGHT',
  'FLIGHT_DEPARTED',
  'FLIGHT_LANDED_LAGOS',
  'DISPATCHED_TO_ORIGIN_PORT',
  'AT_ORIGIN_PORT',
  'LOADED_ON_VESSEL',
  'VESSEL_DEPARTED',
  'VESSEL_ARRIVED_LAGOS_PORT',
  'CUSTOMS_CLEARED_LAGOS',
  'IN_TRANSIT_TO_LAGOS_OFFICE',
  'IN_EXTRA_TRUCK_MOVEMENT_LAGOS',
  'READY_FOR_PICKUP',
  'PICKED_UP_COMPLETED',
  'LOCAL_COURIER_ASSIGNED',
  'IN_TRANSIT_TO_DESTINATION_CITY',
  'OUT_FOR_DELIVERY_DESTINATION_CITY',
  'DELIVERED_TO_RECIPIENT',
  'ON_HOLD',
] as const

export async function batchesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ── List batches ──────────────────────────────────────────────────────────
  app.get('/', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'List all batches (staff+)',
      description: 'Returns batches with customer and order counts. Filter by status or transport mode.',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        status: z.enum(['open', 'cutoff_pending_approval', 'closed']).optional()
          .describe('Filter by batch status.'),
        transportMode: z.enum(['air', 'sea']).optional()
          .describe('Filter by transport mode.'),
        page: z.coerce.number().int().min(1).optional().describe('Page number. Defaults to 1.'),
        limit: z.coerce.number().int().min(1).max(100).optional().describe('Results per page. Defaults to 20.'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            batches: z.array(batchSchema.extend({
              customerCount: z.number(),
              orderCount: z.number(),
              totalWeightKg: z.string(),
            })),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: batchesController.listBatches,
  })

  // ── Get a single batch (summary) ──────────────────────────────────────────
  // ── Available orders for a batch ──────────────────────────────────────────
  // Must be registered BEFORE /:batchId to avoid Fastify treating 'available-orders' as a batchId.
  app.get('/:batchId/available-orders', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'Orders available to add to this batch (staff+)',
      description:
        'Returns all verified-and-priced orders that are not yet in any batch and match the transport mode of this batch (sea batch → ocean shipments; air batch → air and D2D shipments). Use this to populate the order picker in the batch detail UI.',
      security: [{ bearerAuth: [] }],
      params: z.object({ batchId: z.string().uuid() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(z.object({
            orderId: z.string(),
            trackingNumber: z.string(),
            shipmentType: z.string().nullable(),
            weight: z.string().nullable(),
            description: z.string().nullable(),
            customerId: z.string(),
            customerName: z.string().nullable(),
            customerLastName: z.string().nullable(),
            shippingMark: z.string().nullable(),
          })),
        }),
        ...errorSchemas,
      },
    },
    handler: batchesController.getAvailableOrders,
  })

  app.get('/:batchId', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'Get a single batch (staff+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ batchId: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: batchSchema }),
        ...errorSchemas,
      },
    },
    handler: batchesController.getBatch,
  })

  // ── Full batch roster — all customers and their goods ──────────────────────
  app.get('/:batchId/roster', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'Full batch roster — all customers and their goods (staff+)',
      description: 'Returns every customer in the batch, their batch tracking number, all their orders, and a summary of totals and goods types.',
      security: [{ bearerAuth: [] }],
      params: z.object({ batchId: z.string().uuid() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            batch: batchSchema,
            customers: z.array(z.object({
              slotId: z.string(),
              customerId: z.string(),
              customerName: z.string(),
              shippingMark: z.string().nullable(),
              batchTrackingNumber: z.string().describe('The single tracking number this customer uses for all their goods in this batch.'),
              orderCount: z.number(),
              totalWeightKg: z.string(),
              allVerified: z.boolean().describe('True if all this customer\'s orders are verified and priced.'),
              orders: z.array(z.object({
                id: z.string(),
                trackingNumber: z.string(),
                status: z.string().nullable(),
                statusLabel: z.string().nullable(),
                description: z.string().nullable(),
                weightKg: z.string().nullable(),
                shipmentType: z.string().nullable(),
                shipmentTypeLabel: z.string(),
                declaredValueUsd: z.string().nullable(),
                createdAt: z.string(),
              })),
            })),
            summary: z.object({
              totalCustomers: z.number(),
              totalOrders: z.number(),
              totalWeightKg: z.string(),
              unverifiedOrders: z.number().describe('Orders not yet verified and priced. Must be 0 before the batch can be closed.'),
              canClose: z.boolean().describe('True when all orders are verified and priced and the batch has at least one order.'),
              shipmentTypeBreakdown: z.object({ air: z.number(), d2d: z.number() }),
              goodsTypeBreakdown: z.record(z.string(), z.number()),
            }),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: batchesController.getBatchRoster,
  })

  // ── Add an order to the current open batch ────────────────────────────────
  app.post('/:batchId/orders', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'Add a verified order to the open batch (staff+)',
      description: `Adds a verified and priced order to the current open batch for its transport mode.
The order must have status WAREHOUSE_VERIFIED_PRICED.
If this is the customer's first order in this batch, their slot is created and this order's tracking number becomes their batch tracking number.
If they already have a slot, the order is added under their existing tracking number.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ batchId: z.string().uuid() }),
      body: z.object({
        orderId: z.string().uuid().describe('The order to add to the batch.'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            ok: z.literal(true),
            batchId: z.string(),
            masterTrackingNumber: z.string(),
            batchTrackingNumber: z.string().describe('The customer\'s tracking number for this batch.'),
            isNewSlot: z.boolean().describe('True if this is the first order for this customer in this batch.'),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: batchesController.addOrderToBatch,
  })

  // ── Remove an order from a batch ──────────────────────────────────────────
  app.delete('/:batchId/orders/:orderId', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'Remove an order from a batch (staff+)',
      description: 'Removes an order from an open batch. If this was the customer\'s only order in the batch, their slot is also removed. Not allowed on closed batches.',
      security: [{ bearerAuth: [] }],
      params: z.object({
        batchId: z.string().uuid(),
        orderId: z.string().uuid(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ message: z.string() }),
        }),
        ...errorSchemas,
      },
    },
    handler: batchesController.removeOrderFromBatch,
  })

  // ── Update batch status — cascades to all orders ──────────────────────────
  app.patch('/:batchId/status', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'Update batch movement status — cascades to all orders inside (staff+)',
      description: `Updates the batch's current movement stage and applies the same status to every order in the batch.
Also sends a notification to every customer in the batch.
Only allowed on closed batches.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ batchId: z.string().uuid() }),
      body: z.object({
        status: z.enum(ALLOWED_BATCH_STATUSES).describe('The new movement stage for this batch.'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            ok: z.literal(true),
            updatedOrderCount: z.number(),
            newStatus: z.string(),
            statusLabel: z.string(),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: batchesController.updateBatchStatus,
  })

  // ── Close the batch ───────────────────────────────────────────────────────
  app.post('/:batchId/close', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Batches'],
      summary: 'Close the batch — finalises invoices and notifies customers (superadmin)',
      description: `Closes the batch. Before closing:
- All orders must be verified and priced. Any unverified order will block the close.
- Invoices are finalised for all orders in the batch.
- Each customer receives a payment notification showing their total balance.
- A new open batch of the same transport mode is automatically created so incoming goods have somewhere to go.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ batchId: z.string().uuid() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            ok: z.literal(true),
            closedBatch: batchSchema,
            nextBatch: batchSchema,
            customersNotified: z.number(),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: batchesController.closeBatch,
  })

  // ── Status label reference ────────────────────────────────────────────────
  app.get('/status-labels', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Batches'],
      summary: 'All status labels with plain-English descriptions (staff+)',
      description: 'Returns every possible shipment status with a human-readable label and description suitable for displaying to customers.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(z.object({
            status: z.string(),
            label: z.string(),
            description: z.string(),
          })),
        }),
      },
    },
    handler: batchesController.getStatusLabels,
  })
}
