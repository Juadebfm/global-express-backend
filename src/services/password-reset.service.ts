import { eq, and, gt, isNull, desc } from 'drizzle-orm'
import { db } from '../config/db'
import { users, passwordResetOtps } from '../../drizzle/schema'
import { hashEmail } from '../utils/hash'
import { internalAuthService } from './internal-auth.service'
import { sendPasswordResetOtpEmail } from '../notifications/email'

export class PasswordResetService {
  private generateOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString()
  }

  /**
   * Sends a 4-digit OTP to the given email if it belongs to an internal operator.
   * Always returns the same success message to prevent email enumeration.
   */
  async sendOtp(email: string): Promise<void> {
    const emailHash = hashEmail(email)

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1)

    // Only send for internal users (have passwordHash) — customers use Clerk for password reset
    if (!user || !user.passwordHash || !user.isActive) return

    const otp = this.generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await db.insert(passwordResetOtps).values({
      email: email.toLowerCase(),
      otp,
      expiresAt,
    })

    // Fire-and-forget — don't let email failure surface to caller
    sendPasswordResetOtpEmail({ to: email, otp }).catch(() => {})
  }

  /**
   * Verifies the OTP for a given email. Marks it as verified on success.
   */
  async verifyOtp(email: string, otp: string): Promise<boolean> {
    const now = new Date()

    const [record] = await db
      .select()
      .from(passwordResetOtps)
      .where(
        and(
          eq(passwordResetOtps.email, email.toLowerCase()),
          eq(passwordResetOtps.otp, otp),
          gt(passwordResetOtps.expiresAt, now),
          isNull(passwordResetOtps.verifiedAt),
          isNull(passwordResetOtps.usedAt),
        ),
      )
      .limit(1)

    if (!record) return false

    await db
      .update(passwordResetOtps)
      .set({ verifiedAt: now })
      .where(eq(passwordResetOtps.id, record.id))

    return true
  }

  /**
   * Resets the password for the given email.
   * Only succeeds if a verified (but not used) OTP exists within the last 15 minutes.
   */
  async resetPassword(email: string, newPassword: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000)

    const [record] = await db
      .select()
      .from(passwordResetOtps)
      .where(
        and(
          eq(passwordResetOtps.email, email.toLowerCase()),
          gt(passwordResetOtps.verifiedAt, cutoff),
          isNull(passwordResetOtps.usedAt),
        ),
      )
      .orderBy(desc(passwordResetOtps.verifiedAt))
      .limit(1)

    if (!record) return false

    const emailHash = hashEmail(email)
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1)

    if (!user) return false

    await internalAuthService.updatePassword(user.id, newPassword)

    await db
      .update(passwordResetOtps)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetOtps.id, record.id))

    return true
  }
}

export const passwordResetService = new PasswordResetService()
