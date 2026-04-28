import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { clientsController } from '../controllers/clients.controller'
import { adminImportsController } from '../controllers/admin-imports.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove } from '../middleware/requireRole'
import {
  OrderDirection,
  OrderStatus,
  ShipmentPayer,
  ShipmentStatusV2,
  ShipmentType,
  TransportMode,
} from '../types/enums'

const clientSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  businessName: z.string().nullable(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  shippingMark: z.string().nullable(),
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
  departureDate: z.string().nullable(),
  eta: z.string().nullable(),
  createdBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const supplierListItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  businessName: z.string().nullable(),
  email: z.string().email(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  linkedCustomersCount: z.number().int().nonnegative(),
  lastLinkedAt: z.string().nullable(),
  shipmentUsageCount: z.number().int().nonnegative(),
  lastShipmentUsedAt: z.string().nullable(),
  source: z.enum(['saved', 'used', 'saved_and_used']),
  savedAt: z.string().nullable(),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().nullable(),
})

const importRowResultSchema = z.object({
  rowNumber: z.number().int().positive(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  action: z.enum(['create', 'update', 'skip', 'error']),
  message: z.string(),
})

const importResultSchema = z.object({
  dryRun: z.boolean(),
  summary: z.object({
    totalRows: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
  results: z.array(importRowResultSchema),
})

const clientLoginDispatchSchema = z.object({
  id: z.string().uuid().describe('Client UUID'),
  email: z.string().email().describe('Client email'),
  loginLink: z.string().url().describe('Generated secure Clerk login link'),
  linkType: z.enum(['invitation', 'signin_token']),
  whatsappNumber: z.string().describe('WhatsApp number where the login link was sent'),
})

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── POST /admin/imports/users-suppliers ─────────────────────────────────
  app.post('/imports/users-suppliers', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Imports'],
      summary: 'Bulk import users and suppliers from CSV (staff+)',
      description: `Accepts a **multipart/form-data** upload with one file field named \`file\`.

Supported file formats:
- CSV (\`.csv\`)

Use \`dryRun=true\` to validate and preview actions without writing to the database.`,
      consumes: ['multipart/form-data'],
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        dryRun: z.coerce.boolean().optional().default(false),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: importResultSchema }),
        201: z.object({ success: z.literal(true), data: importResultSchema }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: adminImportsController.importUsersAndSuppliers,
  })

  // ─── POST /admin/clients ─────────────────────────────────────────────────
  app.post('/clients', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Provision client login link and share via email + WhatsApp',
      description: `Creates or updates a client profile, generates a secure login link, and sends it directly to the client via **email and WhatsApp**.

**Example:**
\`\`\`json
{
  "email": "customer@example.com",
  "firstName": "Adeola",
  "lastName": "Johnson",
  "phone": "+2348098765432",
  "whatsappNumber": "+2348098765432",
  "addressStreet": "58B Awoniyi Elemo Street",
  "addressCity": "Lagos",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100001"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        email: z.string().email().describe('Customer email address'),
        firstName: z.string().optional().describe('Customer first name (optional)'),
        lastName: z.string().optional().describe('Customer last name (optional)'),
        businessName: z.string().optional().describe('Business / company name (optional)'),
        phone: z.string().optional().describe('Customer phone number (optional)'),
        whatsappNumber: z.string().optional().describe('Customer WhatsApp number (optional)'),
        addressStreet: z.string().optional().describe('Street address (optional)'),
        addressCity: z.string().optional().describe('City (optional)'),
        addressState: z.string().optional().describe('State (optional)'),
        addressCountry: z.string().optional().describe('Country (optional)'),
        addressPostalCode: z.string().optional().describe('Postal code (optional)'),
        consentMarketing: z.boolean().optional().describe('Marketing consent (optional)'),
        shippingMark: z.string().optional().describe('Optional shipping mark (superadmin only)'),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: clientLoginDispatchSchema.extend({
            wasExistingClient: z.boolean(),
          }),
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        409: z.object({ success: z.literal(false), message: z.string() }),
        422: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: clientsController.createClient,
  })

  // ─── POST /admin/clients/:id/send-invite ─────────────────────────────────
  app.post('/clients/:id/send-invite', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Re-share client login link via email + WhatsApp',
      description:
        'Generates a fresh client login link and sends it to the stored email and WhatsApp contact for this client.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Client UUID') }),
      body: z
        .object({
          whatsappNumber: z.string().optional().describe('Optional WhatsApp override before dispatch'),
          phone: z.string().optional().describe('Optional phone override before dispatch'),
        })
        .optional(),
      response: {
        200: z.object({
          success: z.literal(true),
          data: clientLoginDispatchSchema,
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
        422: z.object({ success: z.literal(false), message: z.string() }),
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

Requires **staff** or **superadmin** role.`,
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

  // ─── GET /admin/clients/:id/workbench ────────────────────────────────────
  app.get('/clients/:id/workbench', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Get client workbench data (profile + suppliers + recent orders)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            client: clientDetailSchema,
            suppliers: z.array(supplierListItemSchema),
            suppliersPagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
            recentOrders: z.array(orderSchema),
            recentOrdersPagination: z.object({
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
    handler: clientsController.getClientWorkbench,
  })

  // ─── GET /admin/clients/:id/suppliers ────────────────────────────────────
  app.get('/clients/:id/suppliers', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'List suppliers linked/used by a specific client',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(50),
        isActive: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(supplierListItemSchema),
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
    handler: clientsController.listClientSuppliers,
  })

  // ─── POST /admin/clients/:id/suppliers ───────────────────────────────────
  app.post('/clients/:id/suppliers', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Link/create supplier for a specific client',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z
        .object({
          supplierId: z.string().uuid().optional(),
          email: z.string().email().optional(),
          firstName: z.string().min(1).nullable().optional(),
          lastName: z.string().min(1).nullable().optional(),
          businessName: z.string().min(1).nullable().optional(),
          phone: z.string().min(5).nullable().optional(),
        })
        .refine((value) => Boolean(value.supplierId || value.email), {
          message: 'Provide either supplierId or email',
          path: ['supplierId'],
        }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            supplier: supplierListItemSchema,
            createdSupplier: z.boolean(),
            linkedNow: z.boolean(),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
        409: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: clientsController.saveClientSupplier,
  })

  // ─── POST /admin/clients/:id/goods-intake ────────────────────────────────
  app.post('/clients/:id/goods-intake', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Admin — Clients'],
      summary: 'Create client shipment and input goods in one flow',
      description:
        'Creates a shipment for the selected client and immediately saves warehouse package/supplier details.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z
        .object({
          shipmentType: z.nativeEnum(ShipmentType).optional(),
          orderDirection: z.nativeEnum(OrderDirection).optional(),
          recipientName: z.string().min(1).optional(),
          recipientAddress: z.string().min(1).optional(),
          recipientPhone: z.string().min(1).optional(),
          recipientEmail: z.string().email().optional(),
          description: z.string().optional(),
          shipmentPayer: z.nativeEnum(ShipmentPayer).optional(),
          billingSupplierId: z.string().uuid().optional(),
          transportMode: z.nativeEnum(TransportMode).optional(),
          departureDate: z.string().datetime().optional(),
          packages: z
            .array(
              z.object({
                supplierId: z.string().uuid().optional(),
                arrivalAt: z.string().datetime().optional(),
                description: z.string().optional(),
                itemType: z.string().optional(),
                quantity: z.number().int().positive().optional(),
                lengthCm: z.number().positive().optional(),
                widthCm: z.number().positive().optional(),
                heightCm: z.number().positive().optional(),
                weightKg: z.number().positive().optional(),
                cbm: z.number().positive().optional(),
                itemCostUsd: z.number().positive().optional(),
                requiresExtraTruckMovement: z.boolean().optional(),
                specialPackagingType: z.string().optional(),
                isRestricted: z.boolean().optional(),
                restrictedReason: z.string().optional(),
                restrictedOverrideApproved: z.boolean().optional(),
                restrictedOverrideReason: z.string().optional(),
              }),
            )
            .min(1),
        })
        .superRefine((value, ctx) => {
          if (value.shipmentPayer === ShipmentPayer.SUPPLIER && !value.billingSupplierId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['billingSupplierId'],
              message: 'billingSupplierId is required when shipmentPayer is SUPPLIER',
            })
          }
        }),
      response: {
        201: z.object({ success: z.literal(true), data: orderSchema }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
        409: z.object({ success: z.literal(false), message: z.string() }),
        422: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: clientsController.intakeClientGoods,
  })
}
