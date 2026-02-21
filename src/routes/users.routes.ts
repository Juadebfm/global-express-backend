import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { usersController } from '../controllers/users.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/requireRole'
import { ipWhitelist } from '../middleware/ipWhitelist'
import { UserRole } from '../types/enums'

const userResponseSchema = z.object({
  id: z.string().uuid(),
  clerkId: z.string(),
  // Identity
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  businessName: z.string().nullable(),
  // Contact
  phone: z.string().nullable(),
  whatsappNumber: z.string().nullable(),
  // Address (optional at signup; required before placing an order)
  addressStreet: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressState: z.string().nullable(),
  addressCountry: z.string().nullable(),
  addressPostalCode: z.string().nullable(),
  // Account
  role: z.nativeEnum(UserRole),
  isActive: z.boolean(),
  consentMarketing: z.boolean(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── Self-service routes ─────────────────────────────────────────────────

  app.get('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Get current user profile',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getMe,
  })

  app.patch('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Update current user profile',
      description:
        'Update your profile. Provide either `firstName` + `lastName`, or `businessName` (or both). Address fields are optional here but required before placing an order.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        firstName: z.string().min(1).nullable().optional(),
        lastName: z.string().min(1).nullable().optional(),
        businessName: z.string().min(1).nullable().optional(),
        phone: z.string().min(5).nullable().optional(),
        whatsappNumber: z.string().min(5).nullable().optional(),
        addressStreet: z.string().min(1).nullable().optional(),
        addressCity: z.string().min(1).nullable().optional(),
        addressState: z.string().min(1).nullable().optional(),
        addressCountry: z.string().min(1).nullable().optional(),
        addressPostalCode: z.string().min(1).nullable().optional(),
        consentMarketing: z.boolean().optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
      },
    },
    handler: usersController.updateMe,
  })

  app.delete('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Delete own account (GDPR)',
      description: 'Soft-deletes the account. Data is retained per retention policy.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
      },
    },
    handler: usersController.deleteMe,
  })

  app.get('/me/export', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Export own data (GDPR)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema.nullable() }),
      },
    },
    handler: usersController.exportMyData,
  })

  // ─── Admin routes ─────────────────────────────────────────────────────────

  app.get('/', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Users — Admin'],
      summary: 'List all users',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        role: z.nativeEnum(UserRole).optional(),
        isActive: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
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
      },
    },
    handler: usersController.listUsers,
  })

  app.get('/:id', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Users — Admin'],
      summary: 'Get a user by ID',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getUserById,
  })

  app.patch('/:id', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Users — Admin'],
      summary: 'Update a user',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        firstName: z.string().min(1).nullable().optional(),
        lastName: z.string().min(1).nullable().optional(),
        businessName: z.string().min(1).nullable().optional(),
        phone: z.string().min(5).nullable().optional(),
        whatsappNumber: z.string().min(5).nullable().optional(),
        addressStreet: z.string().min(1).nullable().optional(),
        addressCity: z.string().min(1).nullable().optional(),
        addressState: z.string().min(1).nullable().optional(),
        addressCountry: z.string().min(1).nullable().optional(),
        addressPostalCode: z.string().min(1).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.updateUser,
  })

  app.patch('/:id/role', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Users — Admin'],
      summary: 'Change user role',
      description:
        'Admins can assign staff or user roles only. Superadmin can assign any role including admin and superadmin.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ role: z.nativeEnum(UserRole) }),
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.updateUserRole,
  })

  app.delete('/:id', {
    preHandler: [authenticate, requireSuperAdmin, ipWhitelist],
    schema: {
      tags: ['Users — SuperAdmin'],
      summary: 'Delete a user (soft delete)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.deleteUser,
  })
}
