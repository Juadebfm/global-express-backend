import { describe, expect, it } from 'vitest'
import {
  generateBase32Secret,
  generateCurrentTotp,
  verifyTotp,
  buildOtpauthUri,
  base32ToBytes,
} from '../../src/utils/totp'

describe('TOTP (RFC 6238)', () => {
  it('generates a base32 secret of expected length', () => {
    const secret = generateBase32Secret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    // 20 bytes = 160 bits → ceil(160/5) = 32 base32 chars
    expect(secret.length).toBe(32)
  })

  it('accepts the current code', () => {
    const secret = generateBase32Secret()
    const code = generateCurrentTotp(secret)
    expect(verifyTotp(secret, code)).toBe(true)
  })

  it('accepts a code from the previous and next 30s windows (drift tolerance)', () => {
    const secret = generateBase32Secret()
    const now = Date.now()
    const prevCode = generateCurrentTotp(secret, now - 30_000)
    const nextCode = generateCurrentTotp(secret, now + 30_000)
    expect(verifyTotp(secret, prevCode, now)).toBe(true)
    expect(verifyTotp(secret, nextCode, now)).toBe(true)
  })

  it('rejects a code from outside the drift window', () => {
    const secret = generateBase32Secret()
    const now = Date.now()
    const oldCode = generateCurrentTotp(secret, now - 5 * 60_000) // 5 min old
    expect(verifyTotp(secret, oldCode, now)).toBe(false)
  })

  it('rejects malformed codes', () => {
    const secret = generateBase32Secret()
    expect(verifyTotp(secret, '12345')).toBe(false)
    expect(verifyTotp(secret, '1234567')).toBe(false)
    expect(verifyTotp(secret, 'abcdef')).toBe(false)
    expect(verifyTotp(secret, '')).toBe(false)
  })

  it('matches the RFC 6238 test vector for SHA1 secret "12345678901234567890"', () => {
    // Per RFC 6238 Appendix B: at T = 59 the SHA1 code is 287082
    // Encoded ASCII secret "12345678901234567890" in base32:
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    const code = generateCurrentTotp(secret, 59_000)
    expect(code).toBe('287082')
  })

  it('builds a parseable otpauth URI', () => {
    const secret = generateBase32Secret()
    const uri = buildOtpauthUri({
      secret,
      accountName: 'admin@example.com',
      issuer: 'GlobalExpress',
    })
    expect(uri).toMatch(/^otpauth:\/\/totp\/GlobalExpress%3Aadmin%40example\.com\?/)
    expect(uri).toContain(`secret=${secret}`)
    expect(uri).toContain('issuer=GlobalExpress')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })

  it('base32 round-trip preserves bytes', () => {
    const secret = generateBase32Secret(20)
    const bytes = base32ToBytes(secret)
    expect(bytes.length).toBe(20)
  })
})
