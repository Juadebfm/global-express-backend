import type { FastifyRequest } from 'fastify'
import { db } from '../config/db'
import { securityEvents } from '../../drizzle/schema'

/**
 * Canonical event names. Keep stable — these are queried by SOC tools.
 * Add new ones at the bottom rather than renaming.
 */
export type SecurityEventType =
  | 'login_success'
  | 'login_failure'
  | 'login_locked'
  | 'mfa_verify_success'
  | 'mfa_verify_failure'
  | 'mfa_recovery_used'
  | 'mfa_recovery_failure'
  | 'token_verification_failure'
  | 'token_revoked'
  | 'password_reset_otp_sent'
  | 'password_reset_otp_verified'
  | 'password_reset_otp_failure'
  | 'password_reset_completed'
  | 'logout'
  | 'account_erased'
  | 'permission_denied'
  | 'mfa_enrollment_completed'
  | 'mfa_disabled'
  | 'mfa_recovery_codes_regenerated'

interface LogParams {
  type: SecurityEventType
  request?: FastifyRequest
  userId?: string | null
  ip?: string
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Fire-and-forget write to `security_events`. Never blocks the caller; logs
 * to pino on DB failure so the application doesn't fail just because the
 * security log is unavailable.
 *
 *   logSecurityEvent({ type: 'login_failure', request, metadata: { email } })
 */
export function logSecurityEvent(params: LogParams): void {
  const ip = params.ip ?? params.request?.ip ?? null
  const userAgent =
    params.userAgent ?? params.request?.headers?.['user-agent'] ?? null

  void db
    .insert(securityEvents)
    .values({
      eventType: params.type,
      userId: params.userId ?? null,
      ipAddress: ip,
      userAgent,
      metadata: params.metadata ?? null,
    })
    .catch((err: unknown) => {
      params.request?.log?.warn(
        { err, type: params.type },
        'Failed to write security event',
      )
    })
}
