import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { encrypt, decrypt } from '../utils/encryption'
import { hashEmail } from '../utils/hash'
import { env } from '../config/env'
import { UserRole } from '../types/enums'

export interface CreateInternalUserInput {
  email: string
  password: string
  role: UserRole.STAFF | UserRole.ADMIN | UserRole.SUPERADMIN
  firstName: string
  lastName: string
}

export interface InternalTokenPayload {
  sub: string   // user DB id
  jti: string   // unique token ID — used for revocation
  type: 'internal'
  role: string
  iat: number
  exp: number
}

export class InternalAuthService {
  /**
   * Creates an internal user (staff / admin / superadmin).
   * No Clerk account — credentials are stored in our DB only.
   */
  async createInternalUser(input: CreateInternalUserInput) {
    const passwordHash = await bcrypt.hash(input.password, 12)
    const emailHash = hashEmail(input.email)

    const [user] = await db
      .insert(users)
      .values({
        // clerkId is null for internal users
        email: encrypt(input.email),
        emailHash,
        passwordHash,
        firstName: encrypt(input.firstName),
        lastName: encrypt(input.lastName),
        role: input.role,
        isActive: false,
      })
      .returning()

    return this.decryptUser(user)
  }

  /**
   * Validates email + password for an internal user.
   * Returns the user on success, null on bad credentials or inactive account.
   */
  async validateCredentials(email: string, password: string) {
    const emailHash = hashEmail(email)

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.emailHash, emailHash), isNull(users.deletedAt)))
      .limit(1)

    if (!user || !user.passwordHash) return null
    if (!user.isActive) return null

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return null

    return this.decryptUser(user)
  }

  /**
   * Signs a short-lived JWT for an internal user session.
   * The `type: 'internal'` claim lets the authenticate middleware
   * distinguish this token from a Clerk JWT.
   */
  generateToken(userId: string, role: string): string {
    return jwt.sign(
      { sub: userId, type: 'internal', role },
      env.JWT_SECRET,
      {
        expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
        jwtid: randomUUID(),
      },
    )
  }

  /**
   * Verifies an internal JWT and returns its payload.
   * Throws if the token is invalid or expired.
   */
  verifyToken(token: string): InternalTokenPayload {
    return jwt.verify(token, env.JWT_SECRET) as InternalTokenPayload
  }

  /**
   * Updates an internal user's password.
   */
  async updatePassword(userId: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  }

  private decryptUser(user: typeof users.$inferSelect) {
    return {
      id: user.id,
      clerkId: user.clerkId,
      email: decrypt(user.email),
      firstName: user.firstName ? decrypt(user.firstName) : null,
      lastName: user.lastName ? decrypt(user.lastName) : null,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }
  }
}

export const internalAuthService = new InternalAuthService()
