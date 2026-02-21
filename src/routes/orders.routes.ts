import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { ordersController } from '../controllers/orders.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireStaffOrAbove } from '../middleware/requireRole'
import { OrderStatus, OrderDirection } from '../types/enums'

const orderResponseSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string(),
  senderId: z.string().uuid(),
  recipientName: z.string(),
  recipientAddress: z.string(),
  recipientPhone: z.string(),
  recipientEmail: z.string().nullable(),
  origin: z.string(),
  destination: z.string(),
  status: z.nativeEnum(OrderStatus),
  orderDirection: z.nativeEnum(OrderDirection),
  weight: z.string().nullable(),
  declaredValue: z.string().nullable(),
  description: z.string().nullable(),
  createdBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const paginatedOrdersSchema = z.object({
  data: z.array(orderResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
})

const myShipmentSchema = z.object({
  type: z.enum(['solo', 'bulk_item']),
  id: z.string().uuid(),
  trackingNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  status: z.nativeEnum(OrderStatus),
  orderDirection: z.string().nullable(),
  recipientName: z.string(),
  recipientAddress: z.string(),
  recipientPhone: z.string(),
  recipientEmail: z.string().nullable(),
  weight: z.string().nullable(),
  declaredValue: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function ordersRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── Public ──────────────────────────────────────────────────────────────

  app.get('/track/:trackingNumber', {
    schema: {
      tags: ['Orders — Public'],
      summary: 'Track a shipment by tracking number (public)',
      description: 'Works for both solo orders and bulk shipment items.',
      params: z.object({ trackingNumber: z.string().min(1) }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            trackingNumber: z.string(),
            origin: z.string(),
            destination: z.string(),
            status: z.nativeEnum(OrderStatus),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.trackByTrackingNumber,
  })

  // ─── Customer unified shipments view ──────────────────────────────────────

  app.get('/my-shipments', {
    preHandler: [authenticate],
    schema: {
      tags: ['Orders'],
      summary: 'My shipments (unified — solo orders + bulk items)',
      description:
        'Returns all packages belonging to the authenticated user regardless of whether they are solo orders or part of a bulk shipment.',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(myShipmentSchema),
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
    handler: ordersController.getMyShipments,
  })

  // ─── Authenticated ────────────────────────────────────────────────────────

  app.post('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Orders'],
      summary: 'Create a new shipment order',
      description:
        'Customers create orders for themselves. Staff/admin can create on behalf of a customer by providing senderId.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        senderId: z.string().uuid().optional(),
        recipientName: z.string().min(1),
        recipientAddress: z.string().min(1),
        recipientPhone: z.string().min(1),
        recipientEmail: z.string().email().optional(),
        origin: z.string().min(1),
        destination: z.string().min(1),
        orderDirection: z.nativeEnum(OrderDirection).optional().default(OrderDirection.OUTBOUND),
        weight: z.string().optional(),
        declaredValue: z.string().optional(),
        description: z.string().optional(),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: orderResponseSchema }),
      },
    },
    handler: ordersController.createOrder,
  })

  app.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Orders'],
      summary: 'List orders (customers see only their own; staff+ see all)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        status: z.nativeEnum(OrderStatus).optional(),
        senderId: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: paginatedOrdersSchema }),
      },
    },
    handler: ordersController.listOrders,
  })

  app.get('/:id', {
    preHandler: [authenticate],
    schema: {
      tags: ['Orders'],
      summary: 'Get order by ID',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: orderResponseSchema }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.getOrderById,
  })

  app.patch('/:id/status', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Orders'],
      summary: 'Update order status',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ status: z.nativeEnum(OrderStatus) }),
      response: {
        200: z.object({ success: z.literal(true), data: orderResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.updateOrderStatus,
  })

  app.delete('/:id', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Orders'],
      summary: 'Soft-delete an order (admin+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.deleteOrder,
  })

  app.get('/:id/images', {
    preHandler: [authenticate],
    schema: {
      tags: ['Orders'],
      summary: 'Get package images for an order',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              id: z.string().uuid(),
              orderId: z.string().uuid().nullable(),
              bulkItemId: z.string().uuid().nullable(),
              r2Key: z.string(),
              r2Url: z.string(),
              uploadedBy: z.string().uuid(),
              createdAt: z.string(),
            }),
          ),
        }),
      },
    },
    handler: ordersController.getOrderImages,
  })
}
