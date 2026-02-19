import { describe, it, expect } from 'vitest'
import { generateTrackingNumber } from '../../src/utils/tracking'

describe('generateTrackingNumber', () => {
  it('returns a string in the expected format', () => {
    const tn = generateTrackingNumber()
    expect(tn).toMatch(/^GEX-\d{8}-[A-F0-9]{8}$/)
  })

  it('generates unique tracking numbers', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateTrackingNumber()))
    expect(set.size).toBe(100)
  })
})
