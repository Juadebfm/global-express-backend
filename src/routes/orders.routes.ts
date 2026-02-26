import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { ordersController } from '../controllers/orders.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireStaffOrAbove } from '../middleware/requireRole'
import { OrderStatus, OrderDirection, ShipmentType, TransportMode, ShipmentStatusV2 } from '../types/enums'

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
  shipmentType: z.nativeEnum(ShipmentType).nullable().describe('Transport mode: air | ocean'),
  transportMode: z.nativeEnum(TransportMode).nullable().describe('Normalized transport mode for V2 flow: air | sea'),
  isPreorder: z.boolean().describe('Whether the order was created as a pre-order'),
  departureDate: z.string().nullable().describe('Departure date (ISO 8601)'),
  eta: z.string().nullable().describe('Estimated delivery date (ISO 8601)'),
  statusV2: z.string().nullable().describe('V2 operational status'),
  customerStatusV2: z.string().nullable().describe('Customer-facing mapped V2 status'),
  priceCalculatedAt: z.string().nullable().describe('Timestamp when warehouse verification calculated price'),
  priceCalculatedBy: z.string().uuid().nullable().describe('User who calculated/verified warehouse pricing'),
  calculatedChargeUsd: z.string().nullable().describe('Auto-calculated freight amount in USD'),
  finalChargeUsd: z.string().nullable().describe('Final charge shown to customer in USD'),
  pricingSource: z.string().nullable().describe('Pricing source used for final charge'),
  priceAdjustmentReason: z.string().nullable().describe('Reason for manual adjustment when applied'),
  paymentCollectionStatus: z
    .enum(['UNPAID', 'PAYMENT_IN_PROGRESS', 'PAID_IN_FULL'])
    .describe('Payment collection state for pickup validation'),
  amountDue: z.string().nullable().describe('Amount owed in USD — equals finalChargeUsd until paid, then null'),
  createdBy: z.string().uuid().describe('UUID of the staff/user who created the order'),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const warehouseVerifyPackageSchema = z
  .object({
    description: z.string().optional().describe('Package description'),
    itemType: z.string().optional().describe('Item type/category'),
    quantity: z.number().int().positive().optional().describe('Package/item quantity (default: 1)'),
    lengthCm: z.number().positive().optional().describe('Length in centimeters'),
    widthCm: z.number().positive().optional().describe('Width in centimeters'),
    heightCm: z.number().positive().optional().describe('Height in centimeters'),
    weightKg: z.number().positive().optional().describe('Actual weight in kilograms'),
    cbm: z.number().positive().optional().describe('Volume in cubic meters (exact, no rounding)'),
    isRestricted: z.boolean().optional().describe('Whether package contains a restricted item'),
    restrictedReason: z.string().optional().describe('Restricted item reason'),
    restrictedOverrideApproved: z.boolean().optional().describe('Admin override approval flag'),
    restrictedOverrideReason: z.string().optional().describe('Reason for restricted item override'),
  })
  .superRefine((value, ctx) => {
    if (value.restrictedOverrideApproved && !value.restrictedOverrideReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['restrictedOverrideReason'],
        message: 'restrictedOverrideReason is required when restrictedOverrideApproved is true',
      })
    }
  })

const warehouseVerifyBodySchema = z
  .object({
    transportMode: z
      .nativeEnum(TransportMode)
      .optional()
      .describe('Explicit transport mode override: air | sea'),
    packages: z
      .array(warehouseVerifyPackageSchema)
      .min(1)
      .describe('Verified package details from warehouse intake'),
    manualFinalChargeUsd: z
      .number()
      .positive()
      .optional()
      .describe('Optional manually adjusted final charge in USD'),
    manualAdjustmentReason: z
      .string()
      .optional()
      .describe('Required when manualFinalChargeUsd is provided'),
  })
  .superRefine((value, ctx) => {
    if (value.manualFinalChargeUsd !== undefined && !value.manualAdjustmentReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manualAdjustmentReason'],
        message: 'manualAdjustmentReason is required when manualFinalChargeUsd is provided',
      })
    }
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
  shipmentType: z.nativeEnum(ShipmentType).nullable(),
  departureDate: z.string().nullable(),
  eta: z.string().nullable(),
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
            status: z.string(),
            statusLabel: z.string().describe('Human-readable status label'),
            origin: z.string(),
            destination: z.string(),
            estimatedDelivery: z.string().nullable().describe('Estimated delivery date (null until implemented)'),
            lastUpdate: z.string().describe('Human-readable last update timestamp e.g. "Feb 21, 2026 · 09:14 AM"'),
            lastLocation: z.string().describe('Last known location (destination until location tracking is added)'),
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

The lane is fixed to **South Korea → Lagos, Nigeria** — origin and destination are set automatically.

**Example request body:**
\`\`\`json
{
  "recipientName": "Adeola Johnson",
  "recipientAddress": "5 Victoria Island, Lagos",
  "recipientPhone": "+2348098765432",
  "recipientEmail": "adeola@example.com",
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
  "recipientPhone": "+2348098765432"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        senderId: z.string().uuid().optional().describe('Customer UUID — staff only, to create on behalf of a customer'),
        recipientName: z.string().min(1).describe('Full name of the recipient'),
        recipientAddress: z.string().min(1).describe('Full delivery address for the recipient'),
        recipientPhone: z.string().min(1).describe('Recipient contact phone number'),
        recipientEmail: z.string().email().optional().describe('Recipient email (optional, for delivery notifications)'),
        orderDirection: z.nativeEnum(OrderDirection).optional().default(OrderDirection.OUTBOUND).describe('outbound = we ship TO customer; inbound = customer ships TO us'),
        weight: z.string().optional().describe('Package weight with unit (e.g. "2.5kg")'),
        declaredValue: z.string().optional().describe('Declared monetary value in local currency (e.g. "15000")'),
        description: z.string().optional().describe('Package contents / description'),
        shipmentType: z.nativeEnum(ShipmentType).optional().describe('Transport mode: air | ocean'),
        departureDate: z.string().datetime().optional().describe('Departure date (ISO 8601)'),
        eta: z.string().datetime().optional().describe('Estimated delivery date (ISO 8601)'),
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
- **Staff and above** see all orders and can filter by \`senderId\` or \`statusV2\`.

**Filter examples:**
- In-transit orders: \`?statusV2=FLIGHT_DEPARTED\`
- Orders for a specific customer: \`?senderId=<uuid>\``,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100)'),
        statusV2: z.nativeEnum(ShipmentStatusV2).optional().describe('Filter by V2 status (e.g. FLIGHT_DEPARTED, READY_FOR_PICKUP)'),
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
      description: `Updates the shipment status using the V2 operational status workflow. Customer milestone notifications fire automatically on key statuses.

**Sequential flow (air):**
\`PREORDER_SUBMITTED\` → \`AWAITING_WAREHOUSE_RECEIPT\` → \`WAREHOUSE_RECEIVED\` → \`WAREHOUSE_VERIFIED_PRICED\` → \`DISPATCHED_TO_ORIGIN_AIRPORT\` → \`AT_ORIGIN_AIRPORT\` → \`BOARDED_ON_FLIGHT\` → \`FLIGHT_DEPARTED\` → \`FLIGHT_LANDED_LAGOS\` → \`CUSTOMS_CLEARED_LAGOS\` → \`IN_TRANSIT_TO_LAGOS_OFFICE\` → \`READY_FOR_PICKUP\` → \`PICKED_UP_COMPLETED\`

**Sequential flow (sea):**
\`PREORDER_SUBMITTED\` → \`AWAITING_WAREHOUSE_RECEIPT\` → \`WAREHOUSE_RECEIVED\` → \`WAREHOUSE_VERIFIED_PRICED\` → \`DISPATCHED_TO_ORIGIN_PORT\` → \`AT_ORIGIN_PORT\` → \`LOADED_ON_VESSEL\` → \`VESSEL_DEPARTED\` → \`VESSEL_ARRIVED_LAGOS_PORT\` → \`CUSTOMS_CLEARED_LAGOS\` → \`IN_TRANSIT_TO_LAGOS_OFFICE\` → \`READY_FOR_PICKUP\` → \`PICKED_UP_COMPLETED\`

**Exception statuses** (can be set at any stage): \`ON_HOLD\`, \`CANCELLED\`, \`RESTRICTED_ITEM_REJECTED\`, \`RESTRICTED_ITEM_OVERRIDE_APPROVED\`

**Payment gate:** Order must be \`PAID_IN_FULL\` before transitioning to \`READY_FOR_PICKUP\`.

**Example:**
\`\`\`json
{ "statusV2": "FLIGHT_DEPARTED" }
\`\`\``,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Order UUID') }),
      body: z.object({ statusV2: z.nativeEnum(ShipmentStatusV2).describe('New V2 operational status') }),
      response: {
        200: z.object({ success: z.literal(true), data: orderResponseSchema }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.updateOrderStatus,
  })

  app.post('/:id/warehouse-verify', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Orders'],
      summary: 'Warehouse verification + freight calculation (staff+)',
      description: `Warehouse staff verifies package details, computes freight automatically, and optionally applies a manual final adjustment with a required reason.

This endpoint stores:
- package details (weight/dimensions/cbm/restriction flags)
- auto-calculated USD charge
- final USD charge shown to customer
- V2 status marker (\`WAREHOUSE_VERIFIED_PRICED\`)`,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Order UUID') }),
      body: warehouseVerifyBodySchema,
      response: {
        200: z.object({ success: z.literal(true), data: orderResponseSchema }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: ordersController.verifyOrderAtWarehouse,
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
