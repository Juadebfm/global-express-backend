import { createHmac } from 'crypto'

/**
 * Produces a deterministic HMAC-SHA256 of an email address using the ENCRYPTION_KEY.
 *
 * Why: Email is stored AES-256-GCM encrypted with a random IV, so the same plaintext
 * produces different ciphertext each time — making direct DB lookups impossible.
 * This hash is stable and can be indexed for O(1) login lookups without exposing the email.
 *
 * Reads ENCRYPTION_KEY directly from process.env (same pattern as encryption.ts)
 * so it works in scripts and tests without full env validation.
 */
export function hashEmail(email: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not set')

  return createHmac('sha256', key).update(email.toLowerCase().trim()).digest('hex')
}
