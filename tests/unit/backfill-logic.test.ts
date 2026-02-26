import { describe, it, expect } from 'vitest'
import { mapLegacyStatusToV2 } from '../../src/domain/shipment-v2/status-mapping'
import { OrderStatus, ShipmentStatusV2, TransportMode } from '../../src/types/enums'

describe('Phase 6 backfill — complete legacy→V2 decision table', () => {
  it('maps all mode-independent legacy statuses correctly', () => {
    const cases: [OrderStatus, ShipmentStatusV2][] = [
      [OrderStatus.PENDING, ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED],
      [OrderStatus.OUT_FOR_DELIVERY, ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE],
      [OrderStatus.DELIVERED, ShipmentStatusV2.PICKED_UP_COMPLETED],
      [OrderStatus.CANCELLED, ShipmentStatusV2.CANCELLED],
      [OrderStatus.RETURNED, ShipmentStatusV2.CANCELLED],
    ]
    for (const [legacy, expected] of cases) {
      expect(mapLegacyStatusToV2(legacy, null), `${legacy} with null mode`).toBe(expected)
    }
  })

  it('maps mode-dependent statuses for AIR', () => {
    expect(mapLegacyStatusToV2(OrderStatus.PICKED_UP, TransportMode.AIR)).toBe(
      ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT,
    )
    expect(mapLegacyStatusToV2(OrderStatus.IN_TRANSIT, TransportMode.AIR)).toBe(
      ShipmentStatusV2.FLIGHT_DEPARTED,
    )
  })

  it('maps mode-dependent statuses for SEA', () => {
    expect(mapLegacyStatusToV2(OrderStatus.PICKED_UP, TransportMode.SEA)).toBe(
      ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT,
    )
    expect(mapLegacyStatusToV2(OrderStatus.IN_TRANSIT, TransportMode.SEA)).toBe(
      ShipmentStatusV2.VESSEL_DEPARTED,
    )
  })

  it('returns null for mode-dependent statuses when transportMode is missing (→ flaggedForAdminReview = true)', () => {
    expect(mapLegacyStatusToV2(OrderStatus.PICKED_UP, null)).toBeNull()
    expect(mapLegacyStatusToV2(OrderStatus.IN_TRANSIT, null)).toBeNull()
  })

  it('every OrderStatus maps to a non-null V2 status when transportMode is provided', () => {
    const allLegacy = Object.values(OrderStatus)
    expect(allLegacy).toHaveLength(7)
    for (const status of allLegacy) {
      const result = mapLegacyStatusToV2(status, TransportMode.AIR)
      expect(result, `${status} should map to a V2 status when mode=AIR`).not.toBeNull()
    }
  })
})
