import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { usersController } from '../controllers/users.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/requireRole'
import { PreferredLanguage, UserRole } from '../types/enums'

const userResponseSchema = z.object({
  id: z.string().uuid().describe('Internal user UUID'),
  clerkId: z.string().nullable().describe('Clerk external user ID (null for internal accounts)'),
  // Identity
  email: z.string().email().describe('Primary email address (decrypted)'),
  firstName: z.string().nullable().describe('First name (null if business account)'),
  lastName: z.string().nullable().describe('Last name (null if business account)'),
  businessName: z.string().nullable().describe('Business / company name'),
  // Contact
  phone: z.string().nullable().describe('Primary contact number'),
  whatsappNumber: z.string().nullable().describe('WhatsApp-enabled number (if different from phone)'),
  shippingMark: z.string().nullable().describe('Shipping mark used for package labeling'),
  // Address (optional at signup; required before placing an order)
  addressStreet: z.string().nullable().describe('Street address (encrypted at rest)'),
  addressCity: z.string().nullable().describe('City'),
  addressState: z.string().nullable().describe('State / province'),
  addressCountry: z.string().nullable().describe('Country'),
  addressPostalCode: z.string().nullable().describe('Postal / ZIP code'),
  // Account
  role: z.nativeEnum(UserRole).describe('Account role: user | supplier | staff | superadmin'),
  isActive: z.boolean().describe('Whether the account is active'),
  consentMarketing: z.boolean().describe('Marketing email consent'),
  notifyEmailAlerts: z.boolean().describe('Whether transactional email alerts are enabled'),
  notifySmsAlerts: z.boolean().describe('Whether SMS/WhatsApp alerts are enabled'),
  notifyInAppAlerts: z.boolean().describe('Whether in-app alerts are enabled'),
  preferredLanguage: z
    .nativeEnum(PreferredLanguage)
    .describe('Preferred language for localized dynamic content'),
  deletedAt: z.string().nullable().describe('Soft-delete timestamp (null = active)'),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const profileCompletenessSchema = z.object({
  isComplete: z.boolean().describe('Whether the profile has all fields required for order creation'),
  missingFields: z
    .array(
      z.enum([
        'name',
        'phone',
        'addressStreet',
        'addressCity',
        'addressState',
        'addressCountry',
        'addressPostalCode',
      ]),
    )
    .describe('List of missing required fields. Empty when profile is complete.'),
})

const notificationPreferencesSchema = z.object({
  notifyEmailAlerts: z.boolean().describe('Enable/disable transactional email alerts'),
  notifySmsAlerts: z.boolean().describe('Enable/disable SMS/WhatsApp alerts'),
  notifyInAppAlerts: z.boolean().describe('Enable/disable in-app alerts'),
  consentMarketing: z.boolean().describe('Enable/disable marketing emails'),
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
})

const mySupplierListItemSchema = supplierListItemSchema.extend({
  source: z.enum(['saved', 'used', 'saved_and_used']),
  savedAt: z.string().nullable(),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().nullable(),
})

const saveMySupplierBodySchema = z
  .object({
    supplierId: z
      .string()
      .uuid()
      .optional()
      .describe('Existing supplier user ID. When provided, supplier profile fields are ignored.'),
    email: z.string().email().optional().describe('Supplier email (used to find or create supplier).'),
    firstName: z.string().min(1).nullable().optional().describe('Supplier first name'),
    lastName: z.string().min(1).nullable().optional().describe('Supplier last name'),
    businessName: z.string().min(1).nullable().optional().describe('Supplier business name'),
    phone: z.string().min(5).nullable().optional().describe('Supplier contact phone'),
  })
  .refine((value) => Boolean(value.supplierId || value.email), {
    message: 'Provide either supplierId or email',
    path: ['supplierId'],
  })

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── Self-service routes ─────────────────────────────────────────────────

  app.get('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Get current user profile',
      description: 'Returns the full decrypted profile of the authenticated user.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getMe,
  })

  app.get('/me/completeness', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Get current user profile completeness',
      description: `Returns whether the authenticated profile is complete enough to place an order.

Rules:
- Name requirement: either (\`firstName\` + \`lastName\`) or \`businessName\`
- \`phone\` is required
- Full address is required (\`addressStreet\`, \`addressCity\`, \`addressState\`, \`addressCountry\`, \`addressPostalCode\`)
- \`whatsappNumber\` is optional for completeness`,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: profileCompletenessSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getMyProfileCompleteness,
  })

  app.patch('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Update current user profile',
      description: `Update your profile. All fields are optional — only include fields you want to change.

Provide either \`firstName\` + \`lastName\`, or \`businessName\` (or both). Address fields are optional at signup but **required before placing an order**.

\`shippingMark\` is optional and add-only in self-service:
- You can add it if currently empty.
- Once set, updates are blocked here and require support-ticket + superadmin approval.

**Example request body:**
\`\`\`json
{
  "firstName": "Chidi",
  "lastName": "Okonkwo",
  "phone": "+2348012345678",
  "whatsappNumber": "+2348012345678",
  "addressStreet": "14 Broad Street",
  "addressCity": "Lagos",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100001",
  "consentMarketing": true
}
\`\`\`

**Business account example:**
\`\`\`json
{
  "businessName": "Okonkwo Imports Ltd",
  "phone": "+2348012345678",
  "whatsappNumber": "+2349098765432",
  "addressStreet": "7 Marina Road",
  "addressCity": "Lagos",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "101001"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        firstName: z.string().min(1).nullable().optional().describe('First name'),
        lastName: z.string().min(1).nullable().optional().describe('Last name'),
        businessName: z.string().min(1).nullable().optional().describe('Business / company name'),
        phone: z.string().min(5).nullable().optional().describe('Primary contact number (E.164 format preferred, e.g. +2348012345678)'),
        whatsappNumber: z.string().min(5).nullable().optional().describe('WhatsApp number if different from phone'),
        addressStreet: z.string().min(1).nullable().optional().describe('Street address'),
        addressCity: z.string().min(1).nullable().optional().describe('City'),
        addressState: z.string().min(1).nullable().optional().describe('State / province'),
        addressCountry: z.string().min(1).nullable().optional().describe('Country'),
        addressPostalCode: z.string().min(1).nullable().optional().describe('Postal / ZIP code'),
        shippingMark: z.string().min(1).nullable().optional().describe('Shipping mark (add-only in self-service profile)'),
        consentMarketing: z.boolean().optional().describe('Opt in/out of marketing emails'),
        notifyEmailAlerts: z.boolean().optional().describe('Enable/disable transactional email alerts'),
        notifySmsAlerts: z.boolean().optional().describe('Enable/disable SMS/WhatsApp alerts'),
        notifyInAppAlerts: z.boolean().optional().describe('Enable/disable in-app alerts'),
        preferredLanguage: z
          .nativeEnum(PreferredLanguage)
          .optional()
          .describe('Preferred language: en | ko'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.updateMe,
  })

  app.get('/me/notification-preferences', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Get current user notification preferences',
      description:
        'Returns channel-level notification preferences for the authenticated user.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: notificationPreferencesSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getMyNotificationPreferences,
  })

  app.patch('/me/notification-preferences', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Update current user notification preferences',
      description:
        'Updates channel-level notification preferences for the authenticated user. All fields are optional.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        notifyEmailAlerts: z.boolean().optional().describe('Enable/disable transactional email alerts'),
        notifySmsAlerts: z.boolean().optional().describe('Enable/disable SMS/WhatsApp alerts'),
        notifyInAppAlerts: z.boolean().optional().describe('Enable/disable in-app alerts'),
        consentMarketing: z.boolean().optional().describe('Enable/disable marketing emails'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: notificationPreferencesSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.updateMyNotificationPreferences,
  })

  app.get('/me/suppliers', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'List my saved/used suppliers',
      description:
        'Returns suppliers linked to the authenticated user through saved vendor links and historical shipment usage.',
      security: [{ bearerAuth: [] }],
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
            data: z.array(mySupplierListItemSchema),
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
    handler: usersController.getMySuppliers,
  })

  app.post('/me/suppliers', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Save a supplier/vendor to my account',
      description:
        'Links an existing supplier to the authenticated user or creates a new supplier record by email and links it immediately.',
      security: [{ bearerAuth: [] }],
      body: saveMySupplierBodySchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            supplier: mySupplierListItemSchema,
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
    handler: usersController.saveMySupplier,
  })

  app.delete('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Delete own account (GDPR)',
      description: 'Soft-deletes the authenticated user\'s account. The record is retained in the database with `deletedAt` set per the data retention policy.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.deleteMe,
  })

  app.get('/me/export', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Export own data as PDF (GDPR)',
      description:
        'Returns a PDF containing all personal data held for the authenticated user ' +
        '(profile, orders, payments). Useful for GDPR data subject access requests (Article 15).',
      security: [{ bearerAuth: [] }],
      // No response schema — binary PDF cannot be validated by Zod serializer
    },
    handler: usersController.exportMyData,
  })

  // ─── Admin routes ─────────────────────────────────────────────────────────

  app.get('/', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Users — Admin'],
      summary: 'List all users',
      description: `Returns a paginated list of all users. Filter by role or active status.

**Query examples:**
- All customers: \`?role=user\`
- All suppliers: \`?role=supplier\`
- All staff: \`?role=staff\`
- Inactive accounts: \`?isActive=false\`
- Paginate: \`?page=2&limit=50\``,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number (default: 1)'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100, default: 20)'),
        role: z.nativeEnum(UserRole).optional().describe('Filter by role: user | supplier | staff | superadmin'),
        isActive: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional()
          .describe('Filter by active status: true | false'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(userResponseSchema),
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
    handler: usersController.listUsers,
  })

  app.get('/suppliers', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Users — Admin'],
      summary: 'List suppliers for shipment intake selection',
      description:
        'Returns suppliers (`role=supplier`) for FE selector pickers when creating or appending customer shipments.',
      security: [{ bearerAuth: [] }],
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
      },
    },
    handler: usersController.listSuppliers,
  })

  app.get('/:id', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Users — Admin'],
      summary: 'Get a user by ID',
      description: 'Returns the full decrypted profile for any user. Superadmins use this to view complete customer details.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('User UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getUserById,
  })

  app.patch('/:id', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Users — Admin'],
      summary: 'Update a user',
      description: `Updates any editable field on a user account. All fields are optional — only include fields you want to change.

**Example — activate/deactivate:**
\`\`\`json
{ "isActive": false }
\`\`\`

**Example — correct a customer's address:**
\`\`\`json
{
  "addressStreet": "22 Allen Avenue",
  "addressCity": "Ikeja",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100271"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('User UUID') }),
      body: z.object({
        firstName: z.string().min(1).nullable().optional().describe('First name'),
        lastName: z.string().min(1).nullable().optional().describe('Last name'),
        businessName: z.string().min(1).nullable().optional().describe('Business / company name'),
        phone: z.string().min(5).nullable().optional().describe('Primary contact number'),
        whatsappNumber: z.string().min(5).nullable().optional().describe('WhatsApp number'),
        addressStreet: z.string().min(1).nullable().optional().describe('Street address'),
        addressCity: z.string().min(1).nullable().optional().describe('City'),
        addressState: z.string().min(1).nullable().optional().describe('State / province'),
        addressCountry: z.string().min(1).nullable().optional().describe('Country'),
        addressPostalCode: z.string().min(1).nullable().optional().describe('Postal code'),
        shippingMark: z.string().min(1).nullable().optional().describe('Shipping mark (superadmin can set/change)'),
        isActive: z.boolean().optional().describe('Activate or deactivate the account'),
        preferredLanguage: z
          .nativeEnum(PreferredLanguage)
          .optional()
          .describe('Preferred language: en | ko'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.updateUser,
  })

  app.patch('/:id/role', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Users — Admin'],
      summary: 'Change user role',
      description: `Changes the role assigned to a user.

**Role permissions:**
- **Staff** — cannot assign \`superadmin\`
- **Superadmin** — can assign any role (\`user\`, \`supplier\`, \`staff\`, \`superadmin\`)

**Example:**
\`\`\`json
{ "role": "staff" }
\`\`\``,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('User UUID') }),
      body: z.object({ role: z.nativeEnum(UserRole).describe('New role: user | supplier | staff | superadmin') }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.updateUserRole,
  })

  app.delete('/:id', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Users — SuperAdmin'],
      summary: 'Delete a user (soft delete)',
      description: 'Soft-deletes the user account. The record is retained in the database with `deletedAt` set. Superadmin only.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('User UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.deleteUser,
  })
}
