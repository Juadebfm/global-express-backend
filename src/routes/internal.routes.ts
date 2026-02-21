import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { internalAuthService } from '../services/internal-auth.service'
import { usersService } from '../services/users.service'
import { adminNotificationsService } from '../services/admin-notifications.service'
import { authenticate } from '../middleware/authenticate'
import { requireSuperAdmin, requireAdminOrAbove } from '../middleware/requireRole'
import { ipWhitelist } from '../middleware/ipWhitelist'
import { UserRole } from '../types/enums'

const internalUserResponseSchema = z.object({
  id: z.string().uuid(),
  clerkId: z.string().nullable(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  role: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── Auth ─────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/internal/auth/login
   * Staff / Admin / Superadmin email + password login.
   * Returns a signed JWT valid for JWT_EXPIRES_IN (default 8h).
   */
  app.post('/auth/login', {
    schema: {
      tags: ['Internal — Auth'],
      summary: 'Internal staff/admin login',
      description:
        'Authenticates staff, admin, or superadmin using email and password stored in the backend database. Returns a JWT — include it as `Authorization: Bearer <token>` on all subsequent requests.',
      body: z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            token: z.string(),
            user: internalUserResponseSchema,
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const user = await internalAuthService.validateCredentials(
        request.body.email,
        request.body.password,
      )

      if (!user) {
        return reply.code(401).send({ success: false, message: 'Invalid email or password' })
      }

      const token = internalAuthService.generateToken(user.id, user.role)

      return reply.send({
        success: true,
        data: { token, user },
      })
    },
  })

  // ─── User management (superadmin / admin only) ────────────────────────────

  /**
   * POST /api/v1/internal/users
   * Create a new internal staff, admin, or superadmin account.
   * Superadmin can create any role. Admin can only create staff.
   */
  app.post('/users', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Internal — User Management'],
      summary: 'Create internal staff/admin account',
      description:
        'Creates a staff, admin, or superadmin account. No Clerk account is created — credentials are managed internally. Superadmin can assign any role; admin can only create staff accounts.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        role: z.enum([UserRole.STAFF, UserRole.ADMIN, UserRole.SUPERADMIN]),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: internalUserResponseSchema }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        409: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const requesterRole = request.user.role as UserRole

      // Admins can only create staff accounts
      if (
        requesterRole === UserRole.ADMIN &&
        (request.body.role === UserRole.ADMIN || request.body.role === UserRole.SUPERADMIN)
      ) {
        return reply.code(403).send({
          success: false,
          message: 'Forbidden — admins can only create staff accounts',
        })
      }

      try {
        const user = await internalAuthService.createInternalUser({
          email: request.body.email,
          password: request.body.password,
          role: request.body.role as UserRole.STAFF | UserRole.ADMIN | UserRole.SUPERADMIN,
          firstName: request.body.firstName,
          lastName: request.body.lastName,
        })

        // Fire-and-forget: notify superadmin of new internal account
        adminNotificationsService.notify({
          type: 'new_staff_account',
          title: 'New Staff Account Created',
          body: `A new ${request.body.role} account was created: ${request.body.firstName} ${request.body.lastName}`,
          metadata: { userId: user.id, role: request.body.role, createdBy: request.user.id },
        })

        return reply.code(201).send({ success: true, data: user })
      } catch (err: unknown) {
        // Unique constraint violation — email already exists
        if (err instanceof Error && err.message.includes('unique')) {
          return reply.code(409).send({
            success: false,
            message: 'An account with that email already exists',
          })
        }
        throw err
      }
    },
  })

  /**
   * PATCH /api/v1/internal/users/:id/password
   * Reset any internal user's password (superadmin only).
   */
  app.patch('/users/:id/password', {
    preHandler: [authenticate, requireSuperAdmin, ipWhitelist],
    schema: {
      tags: ['Internal — User Management'],
      summary: 'Reset an internal user\'s password (superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        newPassword: z.string().min(8, 'Password must be at least 8 characters'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const user = await usersService.getUserById(request.params.id)

      if (!user) {
        return reply.code(404).send({ success: false, message: 'User not found' })
      }

      await internalAuthService.updatePassword(request.params.id, request.body.newPassword)

      return reply.send({ success: true, data: { message: 'Password updated successfully' } })
    },
  })

  /**
   * PATCH /api/v1/internal/me/password
   * Internal user changes their own password.
   */
  app.patch('/me/password', {
    preHandler: [authenticate],
    schema: {
      tags: ['Internal — Auth'],
      summary: 'Change own password',
      security: [{ bearerAuth: [] }],
      body: z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, 'Password must be at least 8 characters'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      // Re-validate current password before allowing change
      const profile = await usersService.getUserById(request.user.id)
      if (!profile) {
        return reply.code(401).send({ success: false, message: 'Unauthorized' })
      }

      const valid = await internalAuthService.validateCredentials(
        profile.email,
        request.body.currentPassword,
      )

      if (!valid) {
        return reply.code(401).send({ success: false, message: 'Current password is incorrect' })
      }

      await internalAuthService.updatePassword(request.user.id, request.body.newPassword)

      return reply.send({ success: true, data: { message: 'Password updated successfully' } })
    },
  })

  // ─── Admin Notifications ──────────────────────────────────────────────────

  const notificationSchema = z.object({
    id: z.string().uuid(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })

  /**
   * GET /api/v1/internal/notifications
   * List admin notifications (admin+). Supports ?unreadOnly=true.
   */
  app.get('/notifications', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Internal — Notifications'],
      summary: 'List admin notifications',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
        unreadOnly: z
          .string()
          .optional()
          .transform((v) => v === 'true'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(notificationSchema),
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
    handler: async (request, reply) => {
      const result = await adminNotificationsService.listNotifications({
        page: request.query.page,
        limit: request.query.limit,
        unreadOnly: request.query.unreadOnly,
      })
      return reply.send({
        success: true,
        data: {
          data: result.data.map((n) => ({
            ...n,
            readAt: n.readAt?.toISOString() ?? null,
            createdAt: n.createdAt.toISOString(),
          })),
          pagination: result.pagination,
        },
      })
    },
  })

  /**
   * GET /api/v1/internal/notifications/unread-count
   * Returns unread notification count for badge display.
   */
  app.get('/notifications/unread-count', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Internal — Notifications'],
      summary: 'Get unread notification count',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ count: z.number() }),
        }),
      },
    },
    handler: async (_request, reply) => {
      const count = await adminNotificationsService.getUnreadCount()
      return reply.send({ success: true, data: { count } })
    },
  })

  /**
   * PATCH /api/v1/internal/notifications/read-all
   * Mark all notifications as read.
   */
  app.patch('/notifications/read-all', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Internal — Notifications'],
      summary: 'Mark all notifications as read',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ message: z.string() }),
        }),
      },
    },
    handler: async (_request, reply) => {
      await adminNotificationsService.markAllAsRead()
      return reply.send({ success: true, data: { message: 'All notifications marked as read' } })
    },
  })

  /**
   * PATCH /api/v1/internal/notifications/:id/read
   * Mark a single notification as read.
   */
  app.patch('/notifications/:id/read', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Internal — Notifications'],
      summary: 'Mark a notification as read',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: notificationSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const updated = await adminNotificationsService.markAsRead(request.params.id)

      if (!updated) {
        return reply.code(404).send({
          success: false,
          message: 'Notification not found or already read',
        })
      }

      return reply.send({
        success: true,
        data: {
          ...updated,
          readAt: updated.readAt?.toISOString() ?? null,
          createdAt: updated.createdAt.toISOString(),
        },
      })
    },
  })
}
