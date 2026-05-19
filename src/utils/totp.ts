import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * RFC 6238 TOTP — HMAC-SHA1, 30-second window, 6-digit codes.
 *
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 * No third-party dependency — fewer supply-chain surfaces.
 */

const RFC4648_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6
// Drift tolerance: ±1 step (so ±30s window) — standard for clock skew.
const WINDOW = 1

export function generateBase32Secret(byteLength = 20): string {
  // 20 bytes = 160 bits = RFC 4226 recommended secret size.
  const bytes = randomBytes(byteLength)
  return bytesToBase32(bytes)
}

function bytesToBase32(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      output += RFC4648_BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += RFC4648_BASE32[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32ToBytes(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  if (clean.length === 0) return Buffer.alloc(0)

  let bits = 0
  let value = 0
  const output: number[] = []
  for (let i = 0; i < clean.length; i++) {
    const idx = RFC4648_BASE32.indexOf(clean[i])
    if (idx === -1) {
      throw new Error('Invalid base32 character')
    }
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

function generateCodeAtCounter(secret: string, counter: number): string {
  const key = base32ToBytes(secret)
  // 8-byte big-endian counter.
  const counterBuf = Buffer.alloc(8)
  // High 32 bits — JS bitshift can't represent these for counters < 2^32, but
  // be explicit for forward-compat.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  counterBuf.writeUInt32BE(counter % 0x100000000, 4)

  const hmac = createHmac('sha1', key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const otp = binary % 10 ** DIGITS
  return otp.toString().padStart(DIGITS, '0')
}

/**
 * Generates the current TOTP for `secret`. Mostly used in tests/scripts.
 */
export function generateCurrentTotp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / STEP_SECONDS)
  return generateCodeAtCounter(secret, counter)
}

/**
 * Verifies a user-supplied 6-digit code against `secret` with ±WINDOW step drift.
 * Constant-time per candidate to avoid timing leaks.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false

  const counter = Math.floor(now / 1000 / STEP_SECONDS)
  const submitted = Buffer.from(code)

  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const candidate = generateCodeAtCounter(secret, counter + offset)
    const candidateBuf = Buffer.from(candidate)
    if (candidateBuf.length === submitted.length && timingSafeEqual(candidateBuf, submitted)) {
      return true
    }
  }
  return false
}

/**
 * Builds the otpauth:// URI consumed by authenticator apps (renders as QR on FE).
 *
 *   otpauth://totp/{issuer}:{account}?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30
 */
export function buildOtpauthUri(params: {
  secret: string
  accountName: string
  issuer: string
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`)
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${query.toString()}`
}
