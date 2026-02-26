import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { bulkOrdersController } from '../controllers/bulk-orders.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireStaffOrAbove } from '../middleware/requireRole'
import { ipWhitelist } from '../middleware/ipWhitelist'
import { ShipmentStatusV2 } from '../types/enums'

const bulkItemResponseSchema = z.object({
  id: z.string().uuid(),
  bulkShipmentId: z.string().uuid(),
  customerId: z.string().uuid().describe('UUID of the customer this item belongs to'),
  trackingNumber: z.string().describe('Individual customer-facing tracking number'),
  recipientName: z.string(),
  recipientAddress: z.string(),
  recipientPhone: z.string(),
  recipientEmail: z.string().nullable(),
  weight: z.string().nullable(),
  declaredValue: z.string().nullable(),
  description: z.string().nullable(),
  statusV2: z.nativeEnum(ShipmentStatusV2).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const bulkItemInputSchema = z.object({
  customerId: z.string().uuid().describe('UUID of the customer this item belongs to'),
  recipientName: z.string().min(1).describe('Recipient full name'),
  recipientAddress: z.string().min(1).describe('Full delivery address'),
  recipientPhone: z.string().min(1).describe('Recipient phone number'),
  recipientEmail: z.string().email().optional().describe('Recipient email (optional)'),
  weight: z.string().optional().describe('Package weight (e.g. "1.5kg")'),
  declaredValue: z.string().optional().describe('Declared value in local currency (e.g. "8000")'),
  description: z.string().optional().describe('Package contents / description'),
})

const bulkOrderResponseSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string().describe('Internal bulk tracking number (staff-only, not shared with customers)'),
  origin: z.string(),
  destination: z.string(),
  statusV2: z.nativeEnum(ShipmentStatusV2).nullable(),
  notes: z.string().nullable().describe('Internal staff notes'),
  createdBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(bulkItemResponseSchema).describe('All customer items in this bulk shipment'),
})

const bulkOrderListItemSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  statusV2: z.nativeEnum(ShipmentStatusV2).nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  itemCount: z.number().describe('Number of customer items in this bulk shipment'),
})

export async function bulkOrdersRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Create a bulk shipment with multiple customer items',
      description: `Creates one bulk order with a single internal bulk tracking number and generates **individual tracking numbers** for each customer item.

The bulk tracking number is visible to staff only. Customers track their packages using their individual tracking numbers.

**Example request body:**
\`\`\`json
{
  "origin": "London",
  "destination": "Lagos",
  "notes": "Consolidated shipment — October batch",
  "items": [
    {
      "customerId": "550e8400-e29b-41d4-a716-446655440001",
      "recipientName": "Adeola Johnson",
      "recipientAddress": "5 Victoria Island, Lagos",
      "recipientPhone": "+2348098765432",
      "weight": "1.5kg",
      "declaredValue": "12000",
      "description": "Clothing"
    },
    {
      "customerId": "550e8400-e29b-41d4-a716-446655440002",
      "recipientName": "Emeka Nwosu",
      "recipientAddress": "12 GRA, Port Harcourt",
      "recipientPhone": "+2348076543210",
      "weight": "2.0kg",
      "description": "Books and documents"
    }
  ]
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        origin: z.string().min(1).describe('Shipment origin (e.g. "London")'),
        destination: z.string().min(1).describe('Shipment destination (e.g. "Lagos")'),
        notes: z.string().optional().describe('Internal staff notes (not visible to customers)'),
        items: z.array(bulkItemInputSchema).min(1).describe('Customer items in this bulk shipment (minimum 1)'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: bulkOrderResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.createBulkOrder,
  })

  app.get('/', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'List all bulk orders',
      description: 'Returns a paginated list of all bulk shipments with item counts. Restricted to staff and above.',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100)'),
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
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.listBulkOrders,
  })

  app.get('/:id', {
    preHandler: [authenticate, requireStaffOrAbove, ipWhitelist],
    schema: {
      tags: ['Bulk Orders — Staff'],
      summary: 'Get bulk order with all items',
      description: 'Returns the full bulk shipment record including all customer items and their individual tracking numbers.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Bulk order UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: bulkOrderResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
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
      description: `Updates the status of the bulk shipment **and all its customer items simultaneously**.

**Example:**
\`\`\`json
{ "status": "in_transit" }
\`\`\`

**Status values:** see \`ShipmentStatusV2\` enum for all valid values.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Bulk order UUID') }),
      body: z.object({ statusV2: z.nativeEnum(ShipmentStatusV2).describe('New V2 status for the bulk order and all its items') }),
      response: {
        200: z.object({ success: z.literal(true), data: bulkOrderResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
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
      description: `Adds a new customer item to an existing bulk shipment and generates a tracking number for it.

**Example:**
\`\`\`json
{
  "customerId": "550e8400-e29b-41d4-a716-446655440003",
  "recipientName": "Fatima Bello",
  "recipientAddress": "8 Kano Road, Abuja",
  "recipientPhone": "+2348034567890",
  "weight": "0.8kg",
  "description": "Jewellery"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Bulk order UUID') }),
      body: bulkItemInputSchema,
      response: {
        201: z.object({ success: z.literal(true), data: bulkItemResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
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
      description: 'Soft-deletes a customer item from a bulk shipment. The item record is retained in the database. Admin role required.',
      security: [{ bearerAuth: [] }],
      params: z.object({
        id: z.string().uuid().describe('Bulk order UUID'),
        itemId: z.string().uuid().describe('Bulk item UUID to remove'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
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
      description: 'Soft-deletes the bulk shipment record. The bulk order and its items are retained in the database with `deletedAt` set. Admin role required.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Bulk order UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: bulkOrdersController.deleteBulkOrder,
  })
}
