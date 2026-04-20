import { describe, expect, it } from 'vitest'
import {
  canTransitionSequentially,
  getInitialStatusForMode,
  isExceptionStatus,
} from '../../src/domain/shipment-v2/status-transitions'
import { ShipmentStatusV2, ShipmentType, TransportMode } from '../../src/types/enums'

describe('shipment-v2 status transitions', () => {
  it('exposes correct initial statuses', () => {
    expect(getInitialStatusForMode(TransportMode.AIR)).toBe(
      ShipmentStatusV2.PREORDER_SUBMITTED,
    )
    expect(getInitialStatusForMode(TransportMode.SEA)).toBe(
      ShipmentStatusV2.PREORDER_SUBMITTED,
    )
  })

  it('enforces strict sequential transitions in air flow', () => {
    expect(
      canTransitionSequentially(
        TransportMode.AIR,
        ShipmentStatusV2.PREORDER_SUBMITTED,
        ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT,
      ),
    ).toBe(true)

    expect(
      canTransitionSequentially(
        TransportMode.AIR,
        ShipmentStatusV2.PREORDER_SUBMITTED,
        ShipmentStatusV2.WAREHOUSE_RECEIVED,
      ),
    ).toBe(false)
  })

  it('enforces strict sequential transitions in sea flow', () => {
    expect(
      canTransitionSequentially(
        TransportMode.SEA,
        ShipmentStatusV2.AT_ORIGIN_PORT,
        ShipmentStatusV2.LOADED_ON_VESSEL,
      ),
    ).toBe(true)

    expect(
      canTransitionSequentially(
        TransportMode.SEA,
        ShipmentStatusV2.AT_ORIGIN_PORT,
        ShipmentStatusV2.VESSEL_DEPARTED,
      ),
    ).toBe(false)
  })

  it('allows exception statuses as operational overrides', () => {
    expect(isExceptionStatus(ShipmentStatusV2.CANCELLED)).toBe(true)
    expect(
      canTransitionSequentially(
        TransportMode.AIR,
        ShipmentStatusV2.AT_ORIGIN_AIRPORT,
        ShipmentStatusV2.CANCELLED,
      ),
    ).toBe(true)
  })

  it('supports D2D last-mile progression after Lagos office transit', () => {
    expect(
      canTransitionSequentially(
        TransportMode.AIR,
        ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
        ShipmentStatusV2.LOCAL_COURIER_ASSIGNED,
        ShipmentType.D2D,
      ),
    ).toBe(true)

    expect(
      canTransitionSequentially(
        TransportMode.AIR,
        ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
        ShipmentStatusV2.READY_FOR_PICKUP,
        ShipmentType.D2D,
      ),
    ).toBe(false)
  })
})
