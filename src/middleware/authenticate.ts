import type { FastifyRequest, FastifyReply } from 'fastify'
import { createClerkClient, verifyToken as verifyClerkToken } from '@clerk/backend'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { env } from '../config/env'
import { UserRole } from '../types/enums'
import { encrypt, decrypt } from '../utils/encryption'
import { internalAuthService } from '../services/internal-auth.service'
import { adminNotificationsService } from '../services/admin-notifications.service'

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })

/**
 * Unified authentication middleware â€” handles two token types:
 *
 *   1. Internal JWT  â€” issued by POST /api/v1/internal/auth/login
 *                      for staff / admin / superadmin accounts.
 *                      Identified by `type: 'internal'` claim in the payload.
 *
 *   2. Clerk JWT     â€” issued by Clerk after customer sign-in.
 *                      All other Bearer tokens fall into this path.
 *
 * Attaches `request.user` identically for both paths.
 * Must be used as a preHandler on every protected route.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply
      .code(401)
      .send({ success: false, message: 'Unauthorized â€” missing or invalid Authorization header' })
    return
  }

  const token = authHeader.slice(7)

  // â”€â”€â”€ Peek at the JWT payload without verifying â€” check for internal token â”€â”€
  // We decode (not verify) to read the `type` claim so we know which path to take.
  // Actual verification happens inside each branch.
  let tokenType: string | undefined
  try {
    const parts = token.split('.')
    if (parts.length === 3) {
      const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      tokenType = decoded?.type
    }
  } catch {
    // malformed token â€” will fail in the appropriate branch below
  }

  // â”€â”€â”€ Branch 1: Internal JWT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (tokenType === 'internal') {
    let payload: ReturnType<typeof internalAuthService.verifyToken>

    try {
      payload = internalAuthService.verifyToken(token)
    } catch {
      reply.code(401).send({ success: false, message: 'Unauthorized â€” invalid or expired token' })
      return
    }

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)))
        .limit(1)

      if (!user) {
        reply.code(401).send({ success: false, message: 'Unauthorized â€” account not found' })
        return
      }

      if (!user.isActive) {
        reply.code(403).send({ success: false, message: 'Forbidden â€” account is inactive' })
        return
      }

      request.user = {
        id: user.id,
        clerkId: null, // internal users have no Clerk account
        role: user.role,
        email: decrypt(user.email),
      }
    } catch (err) {
      request.log.error({ err }, 'Internal auth database lookup failed')
      reply.code(500).send({ success: false, message: 'Internal server error during authentication' })
    }

    return
  }

  // â”€â”€â”€ Branch 2: Clerk JWT (customers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let clerkId: string

  try {
    const payload = await verifyClerkToken(token, { secretKey: env.CLERK_SECRET_KEY })

    if (!payload?.sub) {
      reply.code(401).send({ success: false, message: 'Unauthorized â€” invalid token payload' })
      return
    }

    clerkId = payload.sub
  } catch {
    reply.code(401).send({ success: false, message: 'Unauthorized â€” token verification failed' })
    return
  }

  try {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.clerkId, clerkId), isNull(users.deletedAt)))
      .limit(1)

    if (existingUser) {
      if (!existingUser.isActive) {
        reply.code(403).send({ success: false, message: 'Forbidden â€” account is inactive' })
        return
      }

      request.user = {
        id: existingUser.id,
        clerkId: existingUser.clerkId,
        role: existingUser.role,
        email: decrypt(existingUser.email),
      }
      return
    }

    // If a soft-deleted user exists with this Clerk ID, do not auto-reprovision.
    // This preserves account deletion semantics and avoids unique constraint conflicts.
    const [deletedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1)

    if (deletedUser) {
      reply.code(403).send({ success: false, message: 'Forbidden — account has been deleted' })
      return
    }
    // User authenticated with Clerk but not yet in our DB â€” auto-provision on first login
    const clerkUser = await clerk.users.getUser(clerkId)
    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )

    if (!primaryEmail) {
      reply
        .code(422)
        .send({ success: false, message: 'Unprocessable â€” no verified email found in Clerk' })
      return
    }

    const [newUser] = await db
      .insert(users)
      .values({
        clerkId,
        email: encrypt(primaryEmail.emailAddress),
        firstName: clerkUser.firstName ? encrypt(clerkUser.firstName) : null,
        lastName: clerkUser.lastName ? encrypt(clerkUser.lastName) : null,
        role: UserRole.USER,
      })
      .returning()

    request.user = {
      id: newUser.id,
      clerkId: newUser.clerkId,
      role: newUser.role,
      email: primaryEmail.emailAddress,
    }

    // Fire-and-forget: notify superadmin of new customer signup
    adminNotificationsService.notify({
      type: 'new_customer',
      title: 'New Customer Signup',
      body: `A new customer signed up: ${primaryEmail.emailAddress}`,
      metadata: { userId: newUser.id, email: primaryEmail.emailAddress },
    })
  } catch (err) {
    request.log.error({ err }, 'Authentication database lookup failed')
    reply.code(500).send({ success: false, message: 'Internal server error during authentication' })
  }
}

