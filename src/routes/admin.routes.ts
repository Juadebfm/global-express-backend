import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { clientsController } from '../controllers/clients.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove } from '../middleware/requireRole'
import { OrderStatus, ShipmentType, Priority, ShipmentStatusV2 } from '../types/enums'

const clientSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  businessName: z.string().nullable(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressCountry: z.string().nullable(),
  isActive: z.boolean(),
  orderCount: z.number().int(),
  totalSpent: z.string().describe('Sum of successful payments'),
  lastOrderDate: z.string().nullable(),
  createdAt: z.string(),
})

const clientDetailSchema = clientSchema.extend({
  whatsappNumber: z.string().nullable(),
  addressStreet: z.string().nullable(),
  addressState: z.string().nullable(),
  addressPostalCode: z.string().nullable(),
  consentMarketing: z.boolean(),
})

const orderSchema = z.object({
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
  statusV2: z.nativeEnum(ShipmentStatusV2).nullable(),
  orderDirection: z.string(),
  weight: z.string().nullable(),
  declaredValue: z.string().nullable(),
  description: z.string().nullable(),
  shipmentType: z.nativeEnum(ShipmentType).nullable(),
  priority: z.nativeEnum(Priority).nullable(),
  departureDate: z.string().nullable(),
  eta: z.string().nullable(),
  createdBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── POST /admin/clients ─────────────────────────────────────────────────
  app.post('/clients', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Create a client stub and send Clerk invite (staff+)',
      description: `Creates a new customer account stub in the database and immediately sends a Clerk sign-up invitation to the provided email address.

The stub is created with \`isActive: false\`. When the customer accepts the invite and signs in via Clerk for the first time, the authenticate middleware automatically links their Clerk account to the stub and activates it.

**Example:**
\`\`\`json
{
  "email": "customer@example.com",
  "firstName": "Adeola",
  "lastName": "Johnson",
  "phone": "+2348098765432"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        email: z.string().email().describe('Customer email address — Clerk invite will be sent here'),
        firstName: z.string().optional().describe('Customer first name (optional)'),
        lastName: z.string().optional().describe('Customer last name (optional)'),
        businessName: z.string().optional().describe('Business / company name (optional)'),
        phone: z.string().optional().describe('Customer phone number (optional)'),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            id: z.string().uuid().describe('Internal UUID of the created stub'),
            email: z.string().email().describe('Email the invite was sent to'),
          }),
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: clientsController.createClient,
  })

  // ─── POST /admin/clients/:id/send-invite ─────────────────────────────────
  app.post('/clients/:id/send-invite', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Re-send Clerk invite to a client (staff+)',
      description: 'Re-sends the Clerk sign-up invitation to the email address on file for this client. Useful if the original invite expired or was not received.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Client UUID') }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ message: z.string() }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: clientsController.sendInvite,
  })

  // ─── GET /admin/clients ───────────────────────────────────────────────────
  app.get('/clients', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'List all clients (customers) with order/payment aggregates (staff+)',
      description: `Returns a paginated list of all customer accounts with aggregated stats:
- \`orderCount\` — total non-deleted orders
- \`totalSpent\` — sum of successful payments
- \`lastOrderDate\` — most recent order date

Requires **staff**, **admin**, or **superadmin** role.`,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        isActive: z.enum(['true', 'false']).optional().describe('Filter by active status'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(clientSchema),
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
    handler: clientsController.list,
  })

  // ─── GET /admin/clients/:id ───────────────────────────────────────────────
  app.get('/clients/:id', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Get client profile + aggregates (staff+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: clientDetailSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: clientsController.getById,
  })

  // ─── GET /admin/clients/:id/orders ────────────────────────────────────────
  app.get('/clients/:id/orders', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'List orders for a specific client (staff+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        statusV2: z.nativeEnum(ShipmentStatusV2).optional().describe('Filter by V2 order status'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(orderSchema),
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
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: clientsController.listOrders,
  })
}
