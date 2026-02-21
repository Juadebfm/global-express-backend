import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { bulkOrdersController } from '../controllers/bulk-orders.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireStaffOrAbove } from '../middleware/requireRole'
import { ipWhitelist } from '../middleware/ipWhitelist'
import { OrderStatus } from '../types/enums'

const bulkItemResponseSchema = z.object({
  id: z.string().uuid(),
  bulkShipmentId: z.string().uuid(),
  customerId: z.string().uuid(),
  trackingNumber: z.string(),
  recipientName: z.string(),
  recipientAddress: z.string(),
  recipientPhone: z.string(),
  recipientEmail: z.string().nullable(),
  weight: z.string().nullable(),
  declaredValue: z.string().nullable(),
  description: z.string().nullable(),
  status: z.nativeEnum(OrderStatus),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const bulkItemInputSchema = z.object({
  customerId: z.string().uuid(),
  recipientName: z.string().min(1),
  recipientAddress: z.string().min(1),
  recipientPhone: z.string().min(1),
  recipientEmail: z.string().email().optional(),
  weight: z.string().optional(),
  declaredValue: z.string().optional(),
  description: z.string().optional(),
})

const bulkOrderResponseSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  status: z.nativeEnum(OrderStatus),
  notes: z.string().nullable(),
  createdBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(bulkItemResponseSchema),
})

const bulkOrderListItemSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  status: z.nativeEnum(OrderStatus),
  notes: z.string().nullable(),
  createdBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  itemCount: z.number(),
})

export async function bulkOrdersRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Create a bulk shipment with multiple customer items',
      description:
        'Creates one bulk order (with a single bulk tracking number visible to staff only) and generates individual tracking numbers for each customer item.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        origin: z.string().min(1),
        destination: z.string().min(1),
        notes: z.string().optional(),
        items: z.array(bulkItemInputSchema).min(1),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: bulkOrderResponseSchema }),
      },
    },
    handler: bulkOrdersController.createBulkOrder,
  })

  app.get('/', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'List all bulk orders',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(bulkOrderListItemSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
      },
    },
    handler: bulkOrdersController.listBulkOrders,
  })

  app.get('/:id', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Get bulk order with all items',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: bulkOrderResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.getBulkOrderById,
  })

  app.patch('/:id/status', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Update bulk order status (auto-syncs all customer items)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ status: z.nativeEnum(OrderStatus) }),
      response: {
        200: z.object({ success: z.literal(true), data: bulkOrderResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.updateBulkOrderStatus,
  })

  app.post('/:id/items', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Add a customer item to an existing bulk order',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: bulkItemInputSchema,
      response: {
        201: z.object({ success: z.literal(true), data: bulkItemResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.addItem,
  })

  app.delete('/:id/items/:itemId', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Remove a customer item from a bulk order (admin+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.removeItem,
  })

  app.delete('/:id', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Soft-delete a bulk order (admin+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.deleteBulkOrder,
  })
}
