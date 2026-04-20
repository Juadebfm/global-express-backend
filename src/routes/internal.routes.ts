import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { internalAuthService } from '../services/internal-auth.service'
import { usersService } from '../services/users.service'
import { notificationsService } from '../services/notifications.service'
import { authenticate } from '../middleware/authenticate'
import {
  requireSuperAdmin,
  requireAdminOrAbove,
  requireStaffOrAbove,
} from '../middleware/requireRole'
import { UserRole } from '../types/enums'
import { sendWelcomeCredentialsEmail } from '../notifications/email'
import { webPushService } from '../services/web-push.service'
import { env } from '../config/env'
import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { appSettings } from '../../drizzle/schema/app-settings'
import { encrypt } from '../utils/encryption'

const internalUserResponseSchema = z.object({
  id: z.string().uuid(),
  clerkId: z.string().nullable(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  role: z.string(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  mustCompleteProfile: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── Auth ─────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/internal/auth/login
   * Staff / Superadmin email + password login.
   * Returns a signed JWT valid for JWT_EXPIRES_IN (default 8h).
   */
  app.post('/auth/login', {
    schema: {
      tags: ['Internal — Auth'],
      summary: 'Internal staff/superadmin login',
      description:
        'Authenticates staff or superadmin using email and password stored in the backend database. Returns a JWT — include it as `Authorization: Bearer <token>` on all subsequent requests.',
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
        403: z.object({ success: z.literal(false), message: z.string() }),
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

  // ─── User management (superadmin / staff only) ────────────────────────────

  /**
   * POST /api/v1/internal/users
   * Create a new internal staff or superadmin account.
   * Superadmin can create any internal role. Staff can only create staff.
   */
  app.post('/users', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Internal — User Management'],
      summary: 'Create internal staff/superadmin account',
      description:
        'Creates a staff or superadmin account. No Clerk account is created — credentials are managed internally. Superadmin can assign any internal role; staff can only create staff accounts.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        email: z.string().email(),
        role: z.enum([UserRole.STAFF, UserRole.SUPER_ADMIN]),
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

      // Staff can only create staff accounts
      if (
        requesterRole === UserRole.STAFF &&
        request.body.role === UserRole.SUPER_ADMIN
      ) {
        return reply.code(403).send({
          success: false,
          message: 'Forbidden — staff can only create staff accounts',
        })
      }

      try {
        const result = await internalAuthService.createInternalUser({
          email: request.body.email,
          role: request.body.role as UserRole.STAFF | UserRole.SUPER_ADMIN,
          firstName: request.body.firstName,
          lastName: request.body.lastName,
        })

        const { tempPassword, ...user } = result

        // Fire-and-forget: send welcome email with temp credentials
        sendWelcomeCredentialsEmail({
          to: request.body.email,
          firstName: request.body.firstName,
          role: request.body.role,
          temporaryPassword: tempPassword,
          loginUrl: 'https://app.globalexpress.kr/login',
        }).catch((err) => request.log.error(err, 'Failed to send welcome email'))

        // Fire-and-forget: notify superadmin of new internal account
        notificationsService.notifyRole({
          targetRole: UserRole.STAFF,
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
    preHandler: [authenticate, requireSuperAdmin],
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
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Internal — Auth'],
      summary: 'Change own password',
      description:
        'Changes password for authenticated internal operators only (staff/superadmin). Customer (Clerk) accounts must use Clerk-managed password/2FA flows.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, 'Password must be at least 8 characters'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
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

  // ─── Staff Profile Completion ─────────────────────────────────────────────

  /**
   * GET /api/v1/internal/me/profile-requirements
   * Returns which fields are required for profile completion.
   */
  app.get('/me/profile-requirements', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Internal — Profile'],
      summary: 'Get profile completion requirements',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            requireNationalId: z.boolean(),
          }),
        }),
      },
    },
    handler: async (_request, reply) => {
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'require_national_id'))
        .limit(1)

      const requireNationalId = (setting?.value as { enabled?: boolean })?.enabled ?? false

      return reply.send({ success: true, data: { requireNationalId } })
    },
  })

  /**
   * PATCH /api/v1/internal/me/profile
   * Staff/superadmin completes their profile after first login.
   */
  app.patch('/me/profile', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Internal — Profile'],
      summary: 'Complete staff profile',
      description:
        'Completes the mandatory profile for internal users. All fields except nationalId are required. nationalId is required only when the superadmin has enabled it via settings.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        gender: z.enum(['male', 'female', 'other']),
        dateOfBirth: z.string().min(1, 'Date of birth is required'),
        phone: z.string().min(1, 'Phone number is required'),
        addressStreet: z.string().min(1, 'Street address is required'),
        addressCity: z.string().min(1, 'City is required'),
        addressState: z.string().min(1, 'State is required'),
        addressCountry: z.string().min(1, 'Country is required'),
        addressPostalCode: z.string().min(1, 'Postal code is required'),
        emergencyContactName: z.string().min(1, 'Emergency contact name is required'),
        emergencyContactPhone: z.string().min(1, 'Emergency contact phone is required'),
        emergencyContactRelationship: z.string().min(1, 'Emergency contact relationship is required'),
        nationalId: z.string().optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        400: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const body = request.body

      // Check if national ID is required
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'require_national_id'))
        .limit(1)

      const requireNationalId = (setting?.value as { enabled?: boolean })?.enabled ?? false

      if (requireNationalId && !body.nationalId) {
        return reply.code(400).send({
          success: false,
          message: 'National ID / Passport number is required',
        })
      }

      await db
        .update(users)
        .set({
          gender: body.gender,
          dateOfBirth: encrypt(body.dateOfBirth),
          phone: encrypt(body.phone),
          addressStreet: encrypt(body.addressStreet),
          addressCity: body.addressCity,
          addressState: body.addressState,
          addressCountry: body.addressCountry,
          addressPostalCode: body.addressPostalCode,
          emergencyContactName: encrypt(body.emergencyContactName),
          emergencyContactPhone: encrypt(body.emergencyContactPhone),
          emergencyContactRelationship: body.emergencyContactRelationship,
          ...(body.nationalId ? { nationalId: encrypt(body.nationalId) } : {}),
          mustCompleteProfile: false,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, request.user.id))

      // Notify superadmin that the staff member is now fully onboarded and active
      const profile = await usersService.getUserById(request.user.id)
      if (profile) {
        notificationsService.notifyRole({
          targetRole: UserRole.STAFF,
          type: 'staff_onboarding_complete',
          title: 'Staff Onboarding Complete',
          body: `${profile.firstName} ${profile.lastName} (${profile.role}) has completed onboarding and is now active.`,
          metadata: { userId: request.user.id, role: profile.role, email: profile.email },
        })
      }

      return reply.send({ success: true, data: { message: 'Profile completed successfully' } })
    },
  })

  // ─── Superadmin Settings ────────────────────────────────────────────────────

  /**
   * GET /api/v1/internal/settings/require-national-id
   * Get current state of the national ID requirement toggle.
   */
  app.get('/settings/require-national-id', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Internal — Settings'],
      summary: 'Get national ID requirement setting',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ enabled: z.boolean() }),
        }),
      },
    },
    handler: async (_request, reply) => {
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'require_national_id'))
        .limit(1)

      const enabled = (setting?.value as { enabled?: boolean })?.enabled ?? false
      return reply.send({ success: true, data: { enabled } })
    },
  })

  /**
   * PATCH /api/v1/internal/settings/require-national-id
   * Toggle the national ID requirement on or off.
   */
  app.patch('/settings/require-national-id', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Internal — Settings'],
      summary: 'Toggle national ID requirement',
      description: 'When enabled, staff must provide a national ID or passport number during profile completion.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        enabled: z.boolean(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ enabled: z.boolean(), message: z.string() }),
        }),
      },
    },
    handler: async (request, reply) => {
      await db
        .update(appSettings)
        .set({
          value: { enabled: request.body.enabled },
          updatedBy: request.user.id,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.key, 'require_national_id'))

      return reply.send({
        success: true,
        data: {
          enabled: request.body.enabled,
          message: request.body.enabled
            ? 'National ID is now required for staff profile completion'
            : 'National ID is no longer required for staff profile completion',
        },
      })
    },
  })

  // ─── Special Packaging Surcharges ─────────────────────────────────────────

  const surchargeTypeSchema = z.object({
    key: z.string().min(1).describe('Unique key (e.g. "liquid", "fragile")'),
    name: z.string().min(1).describe('Display name (e.g. "Liquid Packaging")'),
    surchargeUsd: z.number().min(0).describe('Surcharge per package in USD'),
  })

  /**
   * GET /api/v1/internal/settings/special-packaging
   * List all special packaging surcharge types. Staff+ can read (to populate dropdowns).
   */
  app.get('/settings/special-packaging', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Internal — Settings'],
      summary: 'Get special packaging surcharge types',
      description: 'Returns configured special packaging types with their per-package surcharge in USD. Staff+ can read for warehouse verification forms.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ types: z.array(surchargeTypeSchema) }),
        }),
      },
    },
    handler: async (_request, reply) => {
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'special_packaging_surcharges'))
        .limit(1)

      const types = (setting?.value as { types?: { key: string; name: string; surchargeUsd: number }[] })?.types ?? []
      return reply.send({ success: true, data: { types } })
    },
  })

  /**
   * PUT /api/v1/internal/settings/special-packaging
   * Replace all special packaging surcharge types. Superadmin only.
   */
  app.put('/settings/special-packaging', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Internal — Settings'],
      summary: 'Set special packaging surcharge types (superadmin)',
      description: 'Replaces the full list of special packaging types. Each type has a key, display name, and per-package USD surcharge.',
      security: [{ bearerAuth: [] }],
      body: z.object({
        types: z.array(surchargeTypeSchema).min(0).max(50),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ types: z.array(surchargeTypeSchema), message: z.string() }),
        }),
      },
    },
    handler: async (request, reply) => {
      // Upsert the setting
      const existing = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'special_packaging_surcharges'))
        .limit(1)

      if (existing.length === 0) {
        await db.insert(appSettings).values({
          key: 'special_packaging_surcharges',
          value: { types: request.body.types },
          description: 'Special packaging surcharge types for warehouse verification',
          updatedBy: request.user.id,
        })
      } else {
        await db
          .update(appSettings)
          .set({
            value: { types: request.body.types },
            updatedBy: request.user.id,
            updatedAt: new Date(),
          })
          .where(eq(appSettings.key, 'special_packaging_surcharges'))
      }

      return reply.send({
        success: true,
        data: {
          types: request.body.types,
          message: `Updated ${request.body.types.length} special packaging surcharge type(s)`,
        },
      })
    },
  })

  // ─── Push Notifications ─────────────────────────────────────────────────────

  /**
   * GET /api/v1/internal/push/vapid-key
   * Returns the VAPID public key for the FE to subscribe to push.
   */
  app.get('/push/vapid-key', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Internal — Push Notifications'],
      summary: 'Get VAPID public key',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ vapidPublicKey: z.string().nullable() }),
        }),
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        success: true,
        data: { vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null },
      })
    },
  })

  /**
   * POST /api/v1/internal/push/subscribe
   * Register a push subscription for the authenticated user.
   */
  app.post('/push/subscribe', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Internal — Push Notifications'],
      summary: 'Subscribe to push notifications',
      security: [{ bearerAuth: [] }],
      body: z.object({
        endpoint: z.string().url(),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
        deviceLabel: z.string().optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
      },
    },
    handler: async (request, reply) => {
      await webPushService.subscribe({
        userId: request.user.id,
        endpoint: request.body.endpoint,
        keys: request.body.keys,
        deviceLabel: request.body.deviceLabel,
      })

      return reply.send({ success: true, data: { message: 'Push subscription registered' } })
    },
  })

  /**
   * POST /api/v1/internal/push/unsubscribe
   * Remove a push subscription.
   */
  app.post('/push/unsubscribe', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Internal — Push Notifications'],
      summary: 'Unsubscribe from push notifications',
      security: [{ bearerAuth: [] }],
      body: z.object({
        endpoint: z.string().url(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
      },
    },
    handler: async (request, reply) => {
      await webPushService.unsubscribe(request.user.id, request.body.endpoint)
      return reply.send({ success: true, data: { message: 'Push subscription removed' } })
    },
  })
}
