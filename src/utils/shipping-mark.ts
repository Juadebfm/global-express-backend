import { randomInt } from 'crypto'

/**
 * Shipping mark — a freeform business alias the customer scrawls on physical
 * boxes so the Korean consolidation warehouse and the Lagos receiving office
 * can match the freight to the right person without scanning a barcode.
 *
 * This is NOT a tracking number — we already have tracking numbers (GEX-…).
 * Real marks from the operations ledger look like: "Ossyjenny", "BeautyByDaz",
 * "Classy ChiDivine", "RW-JEMMY", "The Bolden Co.", "LADIES CITY COSMETICS".
 * They can have spaces, mixed case, hyphens, dots — no format restriction.
 *
 * Format:
 *   - 1–100 characters (any printable content)
 *
 * Auto-generated at customer signup from whatever name we have (Julius
 * Adebowale → `julade`). The customer can replace it ONCE via
 * `PATCH /api/v1/users/me` to use their actual nickname. Staff can change it
 * any time via `PATCH /api/v1/users/:id` (no one-time limit on the staff path).
 *
 * Uniqueness is best-effort, not enforced. Two customers ending up with the
 * same mark is operationally awkward but not catastrophic — the forwarder can
 * disambiguate via tracking number. We rely on customers picking distinct
 * aliases. If collisions become a real problem, add a normalized-hash column
 * and a partial-unique index.
 */

export const SHIPPING_MARK_MIN_LENGTH = 1
export const SHIPPING_MARK_MAX_LENGTH = 100

/**
 * Normalise customer input before validation: strip whitespace, lowercase,
 * collapse to ASCII. This lets a customer type `JUADEB` and have it stored
 * as `julade` — they probably wrote it uppercase on their boxes.
 */
export function normaliseShippingMarkInput(raw: string): string {
  return raw.trim().toLowerCase()
}

export interface ShippingMarkSource {
  firstName?: string | null
  lastName?: string | null
  businessName?: string | null
}

/** Strip to lowercase ASCII letters only. CJK / accented characters are dropped. */
function lower(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Derive a starter alias from whatever identity fields we have. The customer
 * typically replaces this with their actual nickname via PATCH /users/me.
 *
 *   Julius Adebowale       → "julade"          (3 chars of first + 3 of last)
 *   Hayom (single name)    → "hayom"           (single name, ≥ 3 chars)
 *   Jo Li (short pair)     → "joli"            (3+ chars from both)
 *   Pluralcode (business)  → "plural"          (first 6 chars of business)
 *   (nothing usable)       → "user42891"       (fallback — staff should reassign)
 */
export function generateShippingMark(source: ShippingMarkSource): string {
  const first = lower(source.firstName)
  const last = lower(source.lastName)

  // Personal account: combine up to 3 chars from each name.
  if (first && last) {
    const head = first.slice(0, 3) + last.slice(0, 3)
    if (head.length >= SHIPPING_MARK_MIN_LENGTH) return head
  }

  // Single-name personal account (firstName only, or lastName only).
  const single = first || last
  if (single.length >= SHIPPING_MARK_MIN_LENGTH) {
    return single.slice(0, SHIPPING_MARK_MAX_LENGTH)
  }

  // Business account → first chars of business name.
  const biz = lower(source.businessName)
  if (biz.length >= SHIPPING_MARK_MIN_LENGTH) return biz.slice(0, SHIPPING_MARK_MAX_LENGTH)

  // No usable identity info — generic identifier. Staff should reassign these
  // via PATCH /api/v1/users/:id during onboarding review.
  return `user${randomInt(10_000, 100_000)}`
}

export function isValidShippingMark(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= SHIPPING_MARK_MIN_LENGTH && trimmed.length <= SHIPPING_MARK_MAX_LENGTH
}
