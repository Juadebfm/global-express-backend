import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { usersController } from '../controllers/users.controller'
import { authenticate } from '../middleware/authenticate'
import { UserRole } from '../types/enums'

const userResponseSchema = z.object({
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
  role: z.nativeEnum(UserRole),
  isActive: z.boolean(),
  consentMarketing: z.boolean(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  /**
   * REGISTRATION
   * Handled externally by Clerk (https://clerk.com).
   * The frontend embeds Clerk's <SignUp /> component or redirects to the Clerk-hosted sign-up page.
   * No credentials are sent to this backend during sign-up.
   */
  app.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user account',
      description: `**Registration is handled by Clerk (external auth provider).**

The frontend uses Clerk's SDK or pre-built UI to handle sign-up (email/password, Google OAuth, etc.).
This backend is NOT involved in the sign-up form or password storage.

**After the user signs up with Clerk**, call \`POST /api/v1/auth/sync\` with the Clerk session JWT
to create their account in the backend database and receive their profile.

Clerk sign-up docs: https://clerk.com/docs/references/javascript/sign-up`,
      body: z.object({}).describe('No body required — registration is handled by Clerk'),
      response: {
        200: z.object({
          message: z.string(),
          clerkSignUpUrl: z.string(),
        }),
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        message:
          'Registration is handled by Clerk. Use the Clerk SDK in your frontend to sign up, then call POST /api/v1/auth/sync with the resulting JWT.',
        clerkSignUpUrl: 'https://clerk.com/docs/references/javascript/sign-up',
      })
    },
  })

  /**
   * LOGIN
   * Handled externally by Clerk.
   * The frontend uses Clerk's <SignIn /> component or hosted sign-in page.
   * After login, Clerk issues a JWT — pass it as `Authorization: Bearer <token>`.
   */
  app.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login to an existing account',
      description: `**Login is handled by Clerk (external auth provider).**

The frontend uses Clerk's SDK or pre-built UI to sign in.
After a successful login, Clerk issues a short-lived session JWT.

**How to authenticate API requests:**
\`\`\`
Authorization: Bearer <clerk_session_jwt>
\`\`\`

All protected endpoints require this header.

Clerk sign-in docs: https://clerk.com/docs/references/javascript/sign-in`,
      body: z.object({}).describe('No body required — login is handled by Clerk'),
      response: {
        200: z.object({
          message: z.string(),
          clerkSignInUrl: z.string(),
        }),
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        message:
          'Login is handled by Clerk. Use the Clerk SDK in your frontend to sign in and obtain a JWT, then include it as: Authorization: Bearer <token>',
        clerkSignInUrl: 'https://clerk.com/docs/references/javascript/sign-in',
      })
    },
  })

  /**
   * SYNC / FIRST LOGIN
   * Call this after the user signs up or logs in with Clerk for the first time.
   * The authenticate middleware auto-creates the user in our database if they don't exist yet.
   * Returns the user's full profile.
   */
  app.post('/sync', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Sync Clerk user to backend (call after first login)',
      description: `Call this endpoint after a user registers or logs in with Clerk for the first time.

**What it does:**
- Verifies the Clerk JWT
- If the user doesn't exist in our database yet → auto-creates them with role \`user\`
- Returns the full user profile

This is the recommended first call after any Clerk sign-up or sign-in.
It is idempotent — safe to call on every login.`,
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: userResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: usersController.getMe,
  })
}
