import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { lt } from 'drizzle-orm'
import { usersController } from '../controllers/users.controller'
import { usersService } from '../services/users.service'
import { authenticate } from '../middleware/authenticate'
import { internalAuthService } from '../services/internal-auth.service'
import { passwordResetService } from '../services/password-reset.service'
import { db } from '../config/db'
import { revokedTokens } from '../../drizzle/schema'

// Shape the frontend operator dashboard expects
const operatorSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  role: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

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
        200: z.object({ message: z.string(), clerkSignUpUrl: z.string() }),
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        message: 'Registration is handled by Clerk. Use the Clerk SDK useSignUp() hook.',
        clerkSignUpUrl: 'https://clerk.com/docs/references/javascript/sign-up',
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
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getMe,
  })

  // ─── Operator auth (internal staff / admin / superadmin) ──────────────────

  /**
   * POST /api/v1/auth/login
   * Returns { user, tokens: { accessToken } } — matches frontend operator dashboard contract.
   */
  app.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Operator login (staff / admin / superadmin)',
      description: 'Authenticates an internal operator using email and password. Returns the user profile and a JWT access token.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
        password: z.string().min(1).describe('Operator password'),
      }),
      response: {
        200: z.object({
          user: operatorSchema,
          tokens: z.object({ accessToken: z.string() }),
        }),
        401: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const user = await internalAuthService.validateCredentials(
        request.body.email,
        request.body.password,
      )

      if (!user) {
        return reply.code(401).send({ message: 'Invalid email or password' })
      }

      const accessToken = internalAuthService.generateToken(user.id, user.role)

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        tokens: { accessToken },
      })
    },
  })

  /**
   * GET /api/v1/auth/me
   * Restores operator session from stored JWT. Called on every page load.
   */
  app.get('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Get current operator profile',
      description: 'Returns the authenticated operator profile. Call on every page load to restore session from a stored access token.',
      security: [{ bearerAuth: [] }],
      response: {
        200: operatorSchema,
        401: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const user = await usersService.getUserById(request.user.id)
      if (!user) return reply.code(401).send({ message: 'User not found' })
      return reply.send({
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
    },
  })

  /**
   * POST /api/v1/auth/logout
   * Revokes the current internal operator JWT by adding its JTI to the blocklist.
   * The token is immediately invalid on subsequent requests.
   * Clerk customer tokens are not handled here — use Clerk's signOut() instead.
   */
  app.post('/logout', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Operator logout',
      description: 'Revokes the current internal operator JWT. The token is immediately invalid for subsequent requests. Clear it client-side after calling this endpoint.',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ message: z.string() }),
        401: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const token = request.headers.authorization!.slice(7)
      const parts = token.split('.')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))

      await db.insert(revokedTokens).values({
        jti: payload.jti,
        userId: request.user.id,
        expiresAt: new Date(payload.exp * 1000),
      })

      // Lazy cleanup: remove expired entries so the table stays small
      db.delete(revokedTokens)
        .where(lt(revokedTokens.expiresAt, new Date()))
        .catch(() => {})

      return reply.send({ message: 'Logged out successfully' })
    },
  })

  // ─── Forgot password (internal operators only) ────────────────────────────

  app.post('/forgot-password/send-otp', {
    schema: {
      tags: ['Auth'],
      summary: 'Send password reset OTP',
      description: 'Sends a 4-digit OTP to the registered email. Valid for 10 minutes. Always returns 200 to prevent email enumeration.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
      }),
      response: {
        200: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      // Fire-and-forget — same response regardless of whether email exists
      passwordResetService.sendOtp(request.body.email).catch(() => {})
      return reply.send({ message: 'Verification code sent to your email' })
    },
  })

  app.post('/forgot-password/verify-otp', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify password reset OTP',
      description: 'Verifies the 4-digit OTP. Must be called before /reset. OTP expires after 10 minutes.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
        otp: z.string().length(4).describe('4-digit OTP from email'),
      }),
      response: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const valid = await passwordResetService.verifyOtp(request.body.email, request.body.otp)
      if (!valid) {
        return reply.code(400).send({ message: 'Invalid or expired code' })
      }
      return reply.send({ message: 'Code verified successfully' })
    },
  })

  app.post('/forgot-password/reset', {
    schema: {
      tags: ['Auth'],
      summary: 'Reset password',
      description: 'Resets the operator password. Requires a verified OTP (from /verify-otp) within the last 15 minutes.',
      body: z.object({
        email: z.string().email().describe('Operator email address'),
        password: z.string().min(8).describe('New password (min 8 characters)'),
      }),
      response: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const success = await passwordResetService.resetPassword(
        request.body.email,
        request.body.password,
      )
      if (!success) {
        return reply.code(400).send({ message: 'User not found or reset session expired. Please request a new code.' })
      }
      return reply.send({ message: 'Password reset successfully' })
    },
  })
}
