import { describe, it, expect } from 'vitest'
import { generateTrackingNumber, maskTrackingNumber } from '../../src/utils/tracking'

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

describe('maskTrackingNumber', () => {
  it('masks system tracking numbers while preserving recognizability', () => {
    expect(maskTrackingNumber('GEX-20260219-A3F9C21B')).toBe('GEX-20260219-****C21B')
  })

  it('falls back safely for non-standard values', () => {
    expect(maskTrackingNumber('SEED-GALLERY-V1-AG-AIR-001')).toBe('****-001')
    expect(maskTrackingNumber('ABC')).toBe('****')
  })
})
