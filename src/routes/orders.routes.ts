import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { ordersController } from '../controllers/orders.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireStaffOrAbove } from '../middleware/requireRole'
import { OrderStatus, OrderDirection } from '../types/enums'

const orderResponseSchema = z.object({
  id: z.string().uuid().describe('Order UUID'),
  trackingNumber: z.string().describe('Public tracking number (e.g. GE-2024-XXXX)'),
  senderId: z.string().uuid().describe('UUID of the customer who owns this order'),
  recipientName: z.string().describe('Recipient full name'),
  recipientAddress: z.string().describe('Recipient delivery address'),
  recipientPhone: z.string().describe('Recipient phone number'),
  recipientEmail: z.string().nullable().describe('Recipient email (optional)'),
  origin: z.string().describe('Origin city / location'),
  destination: z.string().describe('Destination city / location'),
  status: z.nativeEnum(OrderStatus).describe('Current shipment status'),
  orderDirection: z.nativeEnum(OrderDirection).describe('outbound (us → customer) or inbound (customer → us)'),
  weight: z.string().nullable().describe('Package weight (e.g. "2.5kg")'),
  declaredValue: z.string().nullable().describe('Declared monetary value (e.g. "15000")'),
  description: z.string().nullable().describe('Package description / contents'),
  createdBy: z.string().uuid().describe('UUID of the staff/user who created the order'),
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
  type: z.enum(['solo', 'bulk_item']).describe('Whether this is a solo order or part of a bulk shipment'),
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
      description: `Look up the current status of any shipment by tracking number. No authentication required.

Works for both solo orders and bulk shipment items.

**Example:** \`GET /api/v1/orders/track/GE-2024-AB12\``,
      params: z.object({ trackingNumber: z.string().min(1).describe('Tracking number (e.g. GE-2024-AB12)') }),
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
      description: 'Returns all packages belonging to the authenticated user, regardless of whether they are solo orders or part of a bulk shipment. Sorted by most recent first.',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100)'),
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
        401: z.object({ success: z.literal(false), message: z.string() }),
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
      description: `Creates a new shipment order.

- **Customers** create orders for themselves (\`senderId\` is ignored).
- **Staff / Admin** can create on behalf of a customer by providing \`senderId\`.
- Customers must have a complete profile (name or business name, phone, and full address) before placing an order — returns \`422\` otherwise.

**Example request body:**
\`\`\`json
{
  "recipientName": "Adeola Johnson",
  "recipientAddress": "5 Victoria Island, Lagos",
  "recipientPhone": "+2348098765432",
  "recipientEmail": "adeola@example.com",
  "origin": "London",
  "destination": "Lagos",
  "orderDirection": "outbound",
  "weight": "3.2kg",
  "declaredValue": "45000",
  "description": "Electronics — laptop and accessories"
}
\`\`\`

**Staff creating on behalf of a customer:**
\`\`\`json
{
  "senderId": "550e8400-e29b-41d4-a716-446655440000",
  "recipientName": "Adeola Johnson",
  "recipientAddress": "5 Victoria Island, Lagos",
  "recipientPhone": "+2348098765432",
  "origin": "London",
  "destination": "Lagos"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        senderId: z.string().uuid().optional().describe('Customer UUID — staff only, to create on behalf of a customer'),
        recipientName: z.string().min(1).describe('Full name of the recipient'),
        recipientAddress: z.string().min(1).describe('Full delivery address for the recipient'),
        recipientPhone: z.string().min(1).describe('Recipient contact phone number'),
        recipientEmail: z.string().email().optional().describe('Recipient email (optional, for delivery notifications)'),
        origin: z.string().min(1).describe('Shipment origin city / country (e.g. "London")'),
        destination: z.string().min(1).describe('Shipment destination city / country (e.g. "Lagos")'),
        orderDirection: z.nativeEnum(OrderDirection).optional().default(OrderDirection.OUTBOUND).describe('outbound = we ship TO customer; inbound = customer ships TO us'),
        weight: z.string().optional().describe('Package weight with unit (e.g. "2.5kg")'),
        declaredValue: z.string().optional().describe('Declared monetary value in local currency (e.g. "15000")'),
        description: z.string().optional().describe('Package contents / description'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: orderResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        422: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.createOrder,
  })

  app.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Orders'],
      summary: 'List orders',
      description: `Returns a paginated list of orders.

- **Customers** only see their own orders.
- **Staff and above** see all orders and can filter by \`senderId\` or \`status\`.

**Filter examples:**
- In-transit orders: \`?status=in_transit\`
- Orders for a specific customer: \`?senderId=<uuid>\``,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100)'),
        status: z.nativeEnum(OrderStatus).optional().describe('Filter by status: pending | picked_up | in_transit | out_for_delivery | delivered | cancelled | returned'),
        senderId: z.string().uuid().optional().describe('Filter by customer UUID (staff+ only)'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: paginatedOrdersSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.listOrders,
  })

  app.get('/:id', {
    preHandler: [authenticate],
    schema: {
      tags: ['Orders'],
      summary: 'Get order by ID',
      description: 'Returns full order details. Customers can only view their own orders — returns `403` if they attempt to access another user\'s order.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Order UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: orderResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
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
      summary: 'Update order status (staff+)',
      description: `Updates the shipment status. A notification is sent to the customer when the status changes.

**Status flow:** \`pending\` → \`picked_up\` → \`in_transit\` → \`out_for_delivery\` → \`delivered\`

Can also be set to \`cancelled\` or \`returned\` at any stage.

**Example:**
\`\`\`json
{ "status": "in_transit" }
\`\`\``,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Order UUID') }),
      body: z.object({ status: z.nativeEnum(OrderStatus).describe('New status value') }),
      response: {
        200: z.object({ success: z.literal(true), data: orderResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
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
      description: 'Soft-deletes the order record. The order is retained in the database with `deletedAt` set and will no longer appear in listings. Admin role required.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Order UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
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
      description: 'Returns all package images attached to the order, uploaded by staff during processing. Each image includes a public R2 URL.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Order UUID') }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(
            z.object({
              id: z.string().uuid(),
              orderId: z.string().uuid().nullable(),
              bulkItemId: z.string().uuid().nullable(),
              r2Key: z.string().describe('Cloudflare R2 object key'),
              r2Url: z.string().describe('Public image URL'),
              uploadedBy: z.string().uuid().describe('UUID of the staff who uploaded'),
              createdAt: z.string(),
            }),
          ),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.getOrderImages,
  })
}
