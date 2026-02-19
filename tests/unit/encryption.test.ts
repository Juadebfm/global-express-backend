import { describe, it, expect } from 'vitest'

// Must be set before importing encryption.ts since it reads process.env.ENCRYPTION_KEY at call time
process.env.ENCRYPTION_KEY = 'a'.repeat(64) // 64 hex chars = 32 bytes

import { encrypt, decrypt } from '../../src/utils/encryption'

describe('encryption utils', () => {
  it('encrypts and decrypts a string correctly', () => {
    const original = 'test@example.com'
    const encrypted = encrypt(original)

    expect(encrypted).not.toBe(original)
    expect(encrypted.split(':').length).toBe(3) // iv:authTag:ciphertext

    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const text = 'same input'
    expect(encrypt(text)).not.toBe(encrypt(text))
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('hello')
    const [iv, authTag, ct] = encrypted.split(':')
    const tampered = `${iv}:${authTag}:${ct}ff` // append to corrupt

    expect(() => decrypt(tampered)).toThrow()
  })
})
