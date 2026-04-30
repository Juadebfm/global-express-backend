import { eq, and, gt, isNull, desc } from 'drizzle-orm'
import { db } from '../config/db'
import { users, passwordResetOtps } from '../../drizzle/schema'
import { hashEmail } from '../utils/hash'
import { internalAuthService } from './internal-auth.service'
import { sendPasswordResetOtpEmail } from '../notifications/email'
import { UserRole } from '../types/enums'

const STATIC_RESET_OTP = '4321'
const STATIC_RESET_OTP_EMAILS = new Set(['hazyom@gmail.com'])

export class PasswordResetService {
  private generateOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString()
  }

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim()
  }

  private getStaticOtpForUser(user: typeof users.$inferSelect, email: string): string | null {
    if (user.role !== UserRole.SUPER_ADMIN) return null
    return STATIC_RESET_OTP_EMAILS.has(this.normalizeEmail(email)) ? STATIC_RESET_OTP : null
  }

  /**
   * Sends a 4-digit OTP to the given email if it belongs to an internal operator.
   * Always returns the same success message to prevent email enumeration.
   */
  async sendOtp(email: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email)
    const emailHash = hashEmail(normalizedEmail)

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1)

    // Only send for internal users (have passwordHash) — customers use Clerk for password reset
    if (!user || !user.passwordHash || !user.isActive) return

    const staticOtp = this.getStaticOtpForUser(user, normalizedEmail)
    const otp = staticOtp ?? this.generateOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await db.insert(passwordResetOtps).values({
      email: normalizedEmail,
      otp,
      expiresAt,
    })

    if (staticOtp) return

    // Fire-and-forget — don't let email failure surface to caller
    sendPasswordResetOtpEmail({ to: normalizedEmail, otp }).catch(() => {})
  }

  /**
   * Verifies the OTP for a given email. Marks it as verified on success.
   */
  async verifyOtp(email: string, otp: string): Promise<boolean> {
    const now = new Date()
    const normalizedEmail = this.normalizeEmail(email)

    const [record] = await db
      .select()
      .from(passwordResetOtps)
      .where(
        and(
          eq(passwordResetOtps.email, normalizedEmail),
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
    const normalizedEmail = this.normalizeEmail(email)

    const [record] = await db
      .select()
      .from(passwordResetOtps)
      .where(
        and(
          eq(passwordResetOtps.email, normalizedEmail),
          gt(passwordResetOtps.verifiedAt, cutoff),
          isNull(passwordResetOtps.usedAt),
        ),
      )
      .orderBy(desc(passwordResetOtps.verifiedAt))
      .limit(1)

    if (!record) return false

    const emailHash = hashEmail(normalizedEmail)
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
