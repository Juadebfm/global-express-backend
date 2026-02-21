import type { FastifyRequest, FastifyReply } from 'fastify'
import { createClerkClient, verifyToken } from '@clerk/backend'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { env } from '../config/env'
import { UserRole } from '../types/enums'
import { encrypt, decrypt } from '../utils/encryption'

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })

/**
 * Verifies the Clerk Bearer JWT and attaches the resolved DB user to `request.user`.
 * If the user exists in Clerk but not in our DB (e.g. first login), they are auto-created.
 *
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
      .send({ success: false, message: 'Unauthorized — missing or invalid Authorization header' })
    return
  }

  const token = authHeader.slice(7)

  let clerkId: string

  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY })

    if (!payload?.sub) {
      reply.code(401).send({ success: false, message: 'Unauthorized — invalid token payload' })
      return
    }

    clerkId = payload.sub
  } catch {
    reply.code(401).send({ success: false, message: 'Unauthorized — token verification failed' })
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
        reply.code(403).send({ success: false, message: 'Forbidden — account is inactive' })
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

    // User authenticated with Clerk but not yet in our DB — auto-provision on first login
    const clerkUser = await clerk.users.getUser(clerkId)
    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )

    if (!primaryEmail) {
      reply
        .code(422)
        .send({ success: false, message: 'Unprocessable — no verified email found in Clerk' })
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
  } catch (err) {
    request.log.error({ err }, 'Authentication database lookup failed')
    reply.code(500).send({ success: false, message: 'Internal server error during authentication' })
  }
}
