import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { errorResponseSchema } from '../utils/problem-details'
import { lt } from 'drizzle-orm'
import { usersController } from '../controllers/users.controller'
import { usersService } from '../services/users.service'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove } from '../middleware/requireRole'
import { enforceAdminIpAllowlist } from '../middleware/ipAllowlist'
import { internalAuthService } from '../services/internal-auth.service'
import { mfaService } from '../services/mfa.service'
import { passwordResetService } from '../services/password-reset.service'
import { db } from '../config/db'
import { revokedTokens } from '../../drizzle/schema'
import { logSecurityEvent } from '../utils/security-events'

// Shape the frontend operator dashboard expects
const operatorSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  role: z.string(),
  mustChangePassword: z.boolean(),
  mustCompleteProfile: z.boolean(),
  mustEnrollMfa: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const messageSchema = z.object({ message: z.string() })

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── Customer auth (Clerk) ────────────────────────────────────────────────

  app.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Customer registration (Clerk)',
      description: `**Registration is handled by Clerk.** Use the Clerk SDK (\`useSignUp()\`) in your frontend. After verification completes, call \`POST /api/v1/auth/sync\` to provision the user in the backend.`,
      body: z.object({}).describe('No body — registration handled by Clerk'),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ message: z.string(), clerkSignUpUrl: z.string() }),
        }),
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        success: true,
        data: {
          message: 'Registration is handled by Clerk. Use the Clerk SDK useSignUp() hook.',
          clerkSignUpUrl: 'https://clerk.com/docs/references/javascript/sign-up',
        },
      })
    },
  })

  app.post('/sync', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Sync Clerk user to backend (call after signup/login)',
      description: `Call after a customer signs up or logs in with Clerk. Auto-creates the user in the backend database if they don't exist yet. Idempotent — safe to call on every login.`,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            id: z.string().uuid(),
            clerkId: z.string(),
            email: z.string().email(),
            firstName: z.string().nullable(),
            lastName: z.string().nullable(),
            businessName: z.string().nullable(),
            phone: z.string().nullable(),
            whatsappNumber: z.string().nullable(),
            shippingMark: z.string().nullable(),
            addressStreet: z.string().nullable(),
            addressCity: z.string().nullable(),
            addressState: z.string().nullable(),
            addressCountry: z.string().nullable(),
            addressPostalCode: z.string().nullable(),
            role: z.string(),
            isActive: z.boolean(),
            consentMarketing: z.boolean(),
            notifyEmailAlerts: z.boolean(),
            notifySmsAlerts: z.boolean(),
            notifyInAppAlerts: z.boolean(),
            preferredLanguage: z.enum(['en', 'ko']),
            deletedAt: z.string().nullable(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        }),
        409: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
    handler: usersController.getMe,
  })

  // ─── Operator auth (internal staff / superadmin) ──────────────────

  /**
   * POST /api/v1/auth/login
   *
   * On success (no MFA): { success: true, data: { user, tokens: { accessToken } } }
   * On success (MFA required): { success: true, data: { mfaRequired, mfaToken, userId } }
   */
  app.post('/login', {
    preHandler: [enforceAdminIpAllowlist],
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['Auth'],
      summary: 'Operator login (staff / superadmin)',
      description: 'Authenticates an internal operator using email and password. Returns the user profile and a JWT access token.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
        password: z.string().min(1).describe('Operator password'),
      }),
      response: {
        200: z.union([
          z.object({
            success: z.literal(true),
            data: z.object({
              user: operatorSchema,
              tokens: z.object({ accessToken: z.string() }),
            }),
          }),
          z.object({
            success: z.literal(true),
            data: z.object({
              mfaRequired: z.literal(true),
              mfaToken: z.string(),
              userId: z.string().uuid(),
            }),
          }),
        ]),
        401: errorResponseSchema,
        423: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await internalAuthService.validateCredentials(
        request.body.email,
        request.body.password,
      )

      if (!result.ok) {
        if (result.reason === 'locked') {
          logSecurityEvent({
            type: 'login_locked',
            request,
            metadata: { email: request.body.email, lockedUntil: result.lockedUntil.toISOString() },
          })
          return reply.code(423).send({
            success: false,
            message: 'Account locked due to too many failed attempts. Try again later.',
            lockedUntil: result.lockedUntil.toISOString(),
          })
        }
        logSecurityEvent({
          type: 'login_failure',
          request,
          metadata: { email: request.body.email },
        })
        return reply.code(401).send({ success: false, message: 'Invalid email or password' })
      }

      const user = result.user

      const mfaEnabled = await mfaService.isEnabled(user.id)

      if (mfaEnabled) {
        const mfaToken = mfaService.issueChallengeToken(user.id)
        return reply.send({
          success: true,
          data: {
            mfaRequired: true as const,
            mfaToken,
            userId: user.id,
          },
        })
      }

      const mustEnrollMfa = mfaService.isMfaRequiredForRole(user.role)
      const accessToken = internalAuthService.generateToken(user.id, user.role)

      logSecurityEvent({
        type: 'login_success',
        request,
        userId: user.id,
        metadata: { mfaEnrolled: false, mustEnrollMfa },
      })

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
            mustCompleteProfile: user.mustCompleteProfile,
            mustEnrollMfa,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          tokens: { accessToken },
        },
      })
    },
  })

  app.post('/mfa/verify', {
    preHandler: [enforceAdminIpAllowlist],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Verify MFA challenge and exchange for access token',
      body: z.object({
        mfaToken: z.string().min(1),
        code: z.string().regex(/^\d{6}$/, '6-digit code required'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            user: operatorSchema,
            tokens: z.object({ accessToken: z.string() }),
          }),
        }),
        401: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      let payload
      try {
        payload = mfaService.verifyChallengeToken(request.body.mfaToken)
      } catch {
        return reply.code(401).send({ success: false, message: 'MFA challenge expired or invalid' })
      }

      const verified = await mfaService.verifyUserTotp(payload.sub, request.body.code)
      if (!verified) {
        logSecurityEvent({
          type: 'mfa_verify_failure',
          request,
          userId: payload.sub,
        })
        return reply.code(401).send({ success: false, message: 'Invalid verification code' })
      }

      const userRow = await usersService.getUserById(payload.sub)
      if (!userRow) {
        return reply.code(401).send({ success: false, message: 'User not found' })
      }

      const accessToken = internalAuthService.generateToken(userRow.id, userRow.role)
      logSecurityEvent({ type: 'mfa_verify_success', request, userId: userRow.id })
      logSecurityEvent({
        type: 'login_success',
        request,
        userId: userRow.id,
        metadata: { mfaEnrolled: true, channel: 'totp' },
      })
      return reply.send({
        success: true,
        data: {
          user: {
            id: userRow.id,
            // Internal (staff/superadmin) users always have email
            email: userRow.email!,
            firstName: userRow.firstName,
            lastName: userRow.lastName,
            role: userRow.role,
            mustChangePassword: userRow.mustChangePassword ?? false,
            mustCompleteProfile: userRow.mustCompleteProfile ?? false,
            createdAt: userRow.createdAt,
            updatedAt: userRow.updatedAt,
          },
          tokens: { accessToken },
        },
      })
    },
  })

  app.post('/mfa/recovery', {
    preHandler: [enforceAdminIpAllowlist],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Use a single-use recovery code instead of TOTP',
      body: z.object({
        mfaToken: z.string().min(1),
        recoveryCode: z.string().min(1),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            user: operatorSchema,
            tokens: z.object({ accessToken: z.string() }),
            remainingRecoveryCodes: z.number(),
          }),
        }),
        401: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      let payload
      try {
        payload = mfaService.verifyChallengeToken(request.body.mfaToken)
      } catch {
        return reply.code(401).send({ success: false, message: 'MFA challenge expired or invalid' })
      }

      const consumed = await mfaService.consumeRecoveryCodeForUser(
        payload.sub,
        request.body.recoveryCode,
      )
      if (!consumed) {
        logSecurityEvent({ type: 'mfa_recovery_failure', request, userId: payload.sub })
        return reply.code(401).send({ success: false, message: 'Invalid recovery code' })
      }

      const userRow = await usersService.getUserById(payload.sub)
      if (!userRow) {
        return reply.code(401).send({ success: false, message: 'User not found' })
      }

      const status = await mfaService.getStatus(userRow.id)
      const accessToken = internalAuthService.generateToken(userRow.id, userRow.role)
      logSecurityEvent({
        type: 'mfa_recovery_used',
        request,
        userId: userRow.id,
        metadata: { remainingRecoveryCodes: status.remainingRecoveryCodes },
      })
      logSecurityEvent({
        type: 'login_success',
        request,
        userId: userRow.id,
        metadata: { mfaEnrolled: true, channel: 'recovery_code' },
      })
      return reply.send({
        success: true,
        data: {
          user: {
            id: userRow.id,
            // Internal (staff/superadmin) users always have email
            email: userRow.email!,
            firstName: userRow.firstName,
            lastName: userRow.lastName,
            role: userRow.role,
            mustChangePassword: userRow.mustChangePassword ?? false,
            mustCompleteProfile: userRow.mustCompleteProfile ?? false,
            createdAt: userRow.createdAt,
            updatedAt: userRow.updatedAt,
          },
          tokens: { accessToken },
          remainingRecoveryCodes: status.remainingRecoveryCodes,
        },
      })
    },
  })

  app.get('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Get current operator profile',
      description: 'Returns the authenticated operator profile. Call on every page load to restore session from a stored access token.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: operatorSchema,
        }),
        401: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const user = await usersService.getUserById(request.user.id)
      if (!user) return reply.code(401).send({ success: false, message: 'User not found' })
      return reply.send({
        success: true,
        data: {
          id: user.id,
          // Internal (staff/superadmin) users always have email
          email: user.email!,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          mustCompleteProfile: user.mustCompleteProfile,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      })
    },
  })

  app.post('/logout', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Auth'],
      summary: 'Operator logout',
      description: 'Revokes the current internal operator JWT. The token is immediately invalid for subsequent requests. Clear it client-side after calling this endpoint.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: messageSchema,
        }),
        401: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const authHeader = request.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ success: false, message: 'Unauthorized - missing token' })
      }

      const token = authHeader.slice(7).trim()
      let payload: ReturnType<typeof internalAuthService.verifyToken>
      try {
        payload = internalAuthService.verifyToken(token)
      } catch {
        return reply.code(401).send({ success: false, message: 'Unauthorized - invalid or expired token' })
      }

      if (!payload.jti || payload.sub !== request.user.id) {
        return reply.code(401).send({ success: false, message: 'Unauthorized - invalid token payload' })
      }

      await db
        .insert(revokedTokens)
        .values({
          jti: payload.jti,
          userId: request.user.id,
          expiresAt: new Date(payload.exp * 1000),
        })
        .onConflictDoNothing({ target: revokedTokens.jti })

      db.delete(revokedTokens)
        .where(lt(revokedTokens.expiresAt, new Date()))
        .catch(() => {})

      logSecurityEvent({ type: 'logout', request, userId: request.user.id })
      return reply.send({ success: true, data: { message: 'Logged out successfully' } })
    },
  })

  // ─── Forgot password (internal operators only) ────────────────────────────

  app.post('/forgot-password/send-otp', {
    config: {
      rateLimit: { max: 3, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['Auth'],
      summary: 'Send password reset OTP',
      description: 'Sends a 4-digit OTP to the registered email. Valid for 10 minutes. Always returns 200 to prevent email enumeration.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: messageSchema,
        }),
      },
    },
    handler: async (request, reply) => {
      passwordResetService.sendOtp(request.body.email).catch(() => {})
      logSecurityEvent({
        type: 'password_reset_otp_sent',
        request,
        metadata: { email: request.body.email },
      })
      return reply.send({
        success: true,
        data: { message: 'Verification code sent to your email' },
      })
    },
  })

  app.post('/forgot-password/verify-otp', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['Auth'],
      summary: 'Verify password reset OTP',
      description: 'Verifies the 4-digit OTP. Must be called before /reset. OTP expires after 10 minutes.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
        otp: z.string().length(4).describe('4-digit OTP from email'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: messageSchema,
        }),
        400: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const valid = await passwordResetService.verifyOtp(request.body.email, request.body.otp)
      if (!valid) {
        logSecurityEvent({
          type: 'password_reset_otp_failure',
          request,
          metadata: { email: request.body.email },
        })
        return reply.code(400).send({ success: false, message: 'Invalid or expired code' })
      }
      logSecurityEvent({
        type: 'password_reset_otp_verified',
        request,
        metadata: { email: request.body.email },
      })
      return reply.send({
        success: true,
        data: { message: 'Code verified successfully' },
      })
    },
  })

  app.post('/forgot-password/reset', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['Auth'],
      summary: 'Reset password',
      description: 'Resets the operator password. Requires a verified OTP (from /verify-otp) within the last 15 minutes.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
        password: z.string().min(12).describe('New password (min 12 characters)'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: messageSchema,
        }),
        400: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const success = await passwordResetService.resetPassword(
        request.body.email,
        request.body.password,
      )
      if (!success) {
        return reply.code(400).send({
          success: false,
          message: 'User not found or reset session expired. Please request a new code.',
        })
      }
      logSecurityEvent({
        type: 'password_reset_completed',
        request,
        metadata: { email: request.body.email },
      })
      return reply.send({
        success: true,
        data: { message: 'Password reset successfully' },
      })
    },
  })
}
