import { describe, expect, it } from 'vitest'
import {
  generatePlaintextRecoveryCodes,
  hashRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
} from '../../src/utils/recovery-codes'

describe('MFA recovery codes', () => {
  it('generates 10 codes by default in XXXXX-XXXXX format', () => {
    const codes = generatePlaintextRecoveryCodes()
    expect(codes).toHaveLength(10)
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/)
    }
  })

  it('generates unique codes', () => {
    const codes = generatePlaintextRecoveryCodes()
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('hashes are deterministic per code', () => {
    const code = 'AAAAA-BBBBB'
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code))
  })

  it('hash ignores formatting (hyphen, whitespace, case)', () => {
    const baseline = hashRecoveryCode('aaaaa-bbbbb')
    expect(hashRecoveryCode('AAAAABBBBB')).toBe(baseline)
    expect(hashRecoveryCode(' AAAAA-BBBBB ')).toBe(baseline)
    expect(hashRecoveryCode('aaaaa-bbbbb')).toBe(baseline)
  })

  it('consumeRecoveryCode returns updated list with the matched hash removed', () => {
    const plaintext = generatePlaintextRecoveryCodes(3)
    const hashes = hashRecoveryCodes(plaintext)

    const result = consumeRecoveryCode(plaintext[1], hashes)
    expect(result).not.toBeNull()
    expect(result!.updated).toHaveLength(2)
    expect(result!.updated).not.toContain(hashes[1])
    expect(result!.updated).toContain(hashes[0])
    expect(result!.updated).toContain(hashes[2])
  })

  it('consumeRecoveryCode returns null for an unknown code', () => {
    const plaintext = generatePlaintextRecoveryCodes(3)
    const hashes = hashRecoveryCodes(plaintext)

    expect(consumeRecoveryCode('XXXXX-XXXXX', hashes)).toBeNull()
    expect(consumeRecoveryCode('', hashes)).toBeNull()
  })

  it('consumed code cannot be reused', () => {
    const plaintext = generatePlaintextRecoveryCodes(2)
    const hashes = hashRecoveryCodes(plaintext)

    const firstUse = consumeRecoveryCode(plaintext[0], hashes)
    expect(firstUse).not.toBeNull()

    const reuse = consumeRecoveryCode(plaintext[0], firstUse!.updated)
    expect(reuse).toBeNull()
  })
})
