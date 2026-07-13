import { describe, it, expect } from 'vitest'
import {
  generateTrackingNumber,
  isCustomerTrackingNumber,
  isMasterTrackingNumber,
  maskTrackingNumber,
} from '../../src/utils/tracking'

function createExecutor(start = 0) {
  let current = start

  return {
    insert() {
      return {
        values() {
          return {
            onConflictDoUpdate() {
              return {
                async returning() {
                  current += 1
                  return [{ lastValue: current }]
                },
              }
            },
          }
        },
      }
    },
  }
}

describe('generateTrackingNumber', () => {
  it('returns a string in the expected format', async () => {
    const tn = await generateTrackingNumber(createExecutor(), new Date('2026-07-07T12:00:00Z'))
    expect(tn).toBe('20260707-0001')
  })

  it('generates unique tracking numbers', async () => {
    const executor = createExecutor()
    const values = await Promise.all(
      Array.from({ length: 100 }, () => generateTrackingNumber(executor, new Date('2026-07-07T12:00:00Z'))),
    )
    const set = new Set(values)
    expect(set.size).toBe(100)
  })
})

describe('maskTrackingNumber', () => {
  it('recognizes current customer and master tracking formats', () => {
    expect(isCustomerTrackingNumber('20260707-0001')).toBe(true)
    expect(isCustomerTrackingNumber('TEMP-ABC123')).toBe(false)
    expect(isMasterTrackingNumber('AIR-20260707-0001')).toBe(true)
    expect(isMasterTrackingNumber('GEX-MASTER-AIR-20260707-0001')).toBe(false)
  })

  it('masks system tracking numbers while preserving recognizability', () => {
    expect(maskTrackingNumber('GEX-20260219-A3F9C21B')).toBe('GEX-20260219-****C21B')
    expect(maskTrackingNumber('20260707-0001')).toBe('20260707-****')
  })

  it('falls back safely for non-standard values', () => {
    expect(maskTrackingNumber('SEED-GALLERY-V1-AG-AIR-001')).toBe('****-001')
    expect(maskTrackingNumber('ABC')).toBe('****')
  })
})
