import { describe, it, expect } from 'vitest'
import { ShipmentStatusV2 } from '../../src/types/enums'
import { STATUS_LABELS } from '../../src/domain/shipment-v2/status-labels'

describe('STATUS_LABELS — completeness', () => {
  it('has a non-empty label for every ShipmentStatusV2 value', () => {
    const allStatuses = Object.values(ShipmentStatusV2)
    expect(allStatuses).toHaveLength(22)
    for (const status of allStatuses) {
      const label = STATUS_LABELS[status]
      expect(label, `${status} should have a STATUS_LABEL`).toBeTruthy()
      expect(typeof label).toBe('string')
    }
  })

  it('has no extraneous keys beyond the defined enum values', () => {
    const enumValues = new Set(Object.values(ShipmentStatusV2))
    for (const key of Object.keys(STATUS_LABELS)) {
      expect(enumValues.has(key as ShipmentStatusV2), `"${key}" is not a valid ShipmentStatusV2`).toBe(true)
    }
  })
})
