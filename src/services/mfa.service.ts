import { eq, and, isNull } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { encrypt, decrypt } from '../utils/encryption'
import { env } from '../config/env'
import {
  generateBase32Secret,
  verifyTotp,
  buildOtpauthUri,
} from '../utils/totp'
import {
  generatePlaintextRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from '../utils/recovery-codes'
import { UserRole } from '../types/enums'

const MFA_CHALLENGE_EXPIRES_IN_SECONDS = 5 * 60 // 5 minutes
const ISSUER = 'GlobalExpress'

export interface MfaChallengePayload {
  sub: string
  type: 'mfa_challenge'
  jti: string
  iat: number
  exp: number
}

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

export class MfaService {
  /**
   * Stage 1 of enrollment: generate a new TOTP secret and return the otpauth://
   * URI for the user to scan. Secret is encrypted-at-rest immediately so an attacker
   * with DB read access cannot derive codes. `totpEnabledAt` stays null until the
   * user proves they scanned it via `verifyEnrollment`.
   */
  async beginEnrollment(userId: string, accountEmail: string) {
    const [user] = await db
      .select({ role: users.role, totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!user) throw httpError('User not found', 404)
    if (!this.isInternalRole(user.role)) {
      throw httpError('MFA is only available for internal users', 403)
    }
    if (user.totpEnabledAt) {
      throw httpError('MFA is already enabled. Disable it first to re-enroll.', 409)
    }

    const secret = generateBase32Secret()
    await db
      .update(users)
      .set({
        totpSecret: encrypt(secret),
        totpEnabledAt: null,
        mfaRecoveryCodes: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secret,
        accountName: accountEmail,
        issuer: ISSUER,
      }),
    }
  }

  /**
   * Stage 2 of enrollment: verify the first 6-digit code, mark MFA enabled, and
   * return the one-time recovery codes (caller MUST display these to the user
   * once and instruct them to save them — we only store hashes).
   */
  async verifyEnrollment(userId: string, code: string): Promise<string[]> {
    const [user] = await db
      .select({ totpSecret: users.totpSecret, totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!user?.totpSecret) {
      throw httpError('No enrollment in progress', 409)
    }
    if (user.totpEnabledAt) {
      throw httpError('MFA is already enabled', 409)
    }

    const secret = decrypt(user.totpSecret)
    if (!verifyTotp(secret, code)) {
      throw httpError('Invalid verification code', 401)
    }

    const plaintextCodes = generatePlaintextRecoveryCodes()
    await db
      .update(users)
      .set({
        totpEnabledAt: new Date(),
        mfaRecoveryCodes: hashRecoveryCodes(plaintextCodes),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    return plaintextCodes
  }

  /**
   * Disables MFA. Requires a valid TOTP code (caller has already re-verified
   * the user's password at the route layer).
   */
  async disable(userId: string, code: string): Promise<void> {
    const [user] = await db
      .select({ totpSecret: users.totpSecret, totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!user?.totpEnabledAt || !user.totpSecret) {
      throw httpError('MFA is not enabled', 409)
    }

    const secret = decrypt(user.totpSecret)
    if (!verifyTotp(secret, code)) {
      throw httpError('Invalid verification code', 401)
    }

    await db
      .update(users)
      .set({
        totpSecret: null,
        totpEnabledAt: null,
        mfaRecoveryCodes: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
  }

  /**
   * Generates a fresh set of recovery codes, invalidating the previous set.
   * Returns the plaintext codes for one-time display.
   */
  async regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
    const [user] = await db
      .select({ totpSecret: users.totpSecret, totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!user?.totpEnabledAt || !user.totpSecret) {
      throw httpError('MFA is not enabled', 409)
    }

    const secret = decrypt(user.totpSecret)
    if (!verifyTotp(secret, code)) {
      throw httpError('Invalid verification code', 401)
    }

    const plaintextCodes = generatePlaintextRecoveryCodes()
    await db
      .update(users)
      .set({ mfaRecoveryCodes: hashRecoveryCodes(plaintextCodes), updatedAt: new Date() })
      .where(eq(users.id, userId))

    return plaintextCodes
  }

  /**
   * Issues a short-lived MFA challenge JWT that must be exchanged (together with
   * a valid TOTP code or recovery code) for a real access token.
   */
  issueChallengeToken(userId: string): string {
    return jwt.sign(
      { sub: userId, type: 'mfa_challenge' },
      env.JWT_SECRET,
      {
        expiresIn: MFA_CHALLENGE_EXPIRES_IN_SECONDS,
        jwtid: randomUUID(),
      },
    )
  }

  verifyChallengeToken(token: string): MfaChallengePayload {
    const payload = jwt.verify(token, env.JWT_SECRET) as MfaChallengePayload
    if (payload.type !== 'mfa_challenge') {
      throw new Error('Not an MFA challenge token')
    }
    return payload
  }

  /**
   * Verifies a TOTP code against the user's stored secret.
   */
  async verifyUserTotp(userId: string, code: string): Promise<boolean> {
    const [user] = await db
      .select({ totpSecret: users.totpSecret, totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!user?.totpEnabledAt || !user.totpSecret) return false
    const secret = decrypt(user.totpSecret)
    return verifyTotp(secret, code)
  }

  /**
   * Verifies a recovery code; on success, removes it from the stored list.
   */
  async consumeRecoveryCodeForUser(userId: string, code: string): Promise<boolean> {
    const [user] = await db
      .select({
        totpEnabledAt: users.totpEnabledAt,
        mfaRecoveryCodes: users.mfaRecoveryCodes,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!user?.totpEnabledAt) return false
    const stored = user.mfaRecoveryCodes ?? []

    const result = consumeRecoveryCode(code, stored)
    if (!result) return false

    await db
      .update(users)
      .set({ mfaRecoveryCodes: result.updated, updatedAt: new Date() })
      .where(eq(users.id, userId))

    return true
  }

  async isEnabled(userId: string): Promise<boolean> {
    const [user] = await db
      .select({ totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)
    return Boolean(user?.totpEnabledAt)
  }

  async getStatus(userId: string) {
    const [user] = await db
      .select({
        role: users.role,
        totpEnabledAt: users.totpEnabledAt,
        mfaRecoveryCodes: users.mfaRecoveryCodes,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)

    if (!user) throw httpError('User not found', 404)

    return {
      enabled: Boolean(user.totpEnabledAt),
      enabledAt: user.totpEnabledAt?.toISOString() ?? null,
      remainingRecoveryCodes: user.mfaRecoveryCodes?.length ?? 0,
      isRequiredForRole: this.isMfaRequiredForRole(user.role),
    }
  }

  /**
   * Policy: superadmin MUST have MFA. Staff may opt in.
   * Enforcement is gated at login (see login handler in routes/internal.ts).
   */
  isMfaRequiredForRole(role: string): boolean {
    return role === UserRole.SUPER_ADMIN
  }

  private isInternalRole(role: string): boolean {
    return role === UserRole.SUPER_ADMIN || role === UserRole.STAFF
  }
}

export const mfaService = new MfaService()
