import { describe, expect, it } from 'vitest'
import {
  mapLegacyStatusToV2,
  resolveTransportModeFromShipmentType,
} from '../../src/domain/shipment-v2/status-mapping'
import { OrderStatus, ShipmentStatusV2, TransportMode } from '../../src/types/enums'

describe('shipment-v2 status mapping', () => {
  it('maps shipment type to transport mode', () => {
    expect(resolveTransportModeFromShipmentType('air')).toBe(TransportMode.AIR)
    expect(resolveTransportModeFromShipmentType('ocean')).toBe(TransportMode.SEA)
    expect(resolveTransportModeFromShipmentType('road')).toBeNull()
    expect(resolveTransportModeFromShipmentType(null)).toBeNull()
  })

  it('maps legacy statuses that are mode-independent', () => {
    expect(mapLegacyStatusToV2(OrderStatus.PENDING, null)).toBe(
      ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
    )
    expect(mapLegacyStatusToV2(OrderStatus.OUT_FOR_DELIVERY, null)).toBe(
      ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
    )
    expect(mapLegacyStatusToV2(OrderStatus.DELIVERED, null)).toBe(
      ShipmentStatusV2.PICKED_UP_COMPLETED,
    )
    expect(mapLegacyStatusToV2(OrderStatus.CANCELLED, null)).toBe(
      ShipmentStatusV2.CANCELLED,
    )
  })

  it('maps mode-dependent legacy statuses for air and sea', () => {
    expect(mapLegacyStatusToV2(OrderStatus.PICKED_UP, TransportMode.AIR)).toBe(
      ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT,
    )
    expect(mapLegacyStatusToV2(OrderStatus.PICKED_UP, TransportMode.SEA)).toBe(
      ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT,
    )
    expect(mapLegacyStatusToV2(OrderStatus.IN_TRANSIT, TransportMode.AIR)).toBe(
      ShipmentStatusV2.FLIGHT_DEPARTED,
    )
    expect(mapLegacyStatusToV2(OrderStatus.IN_TRANSIT, TransportMode.SEA)).toBe(
      ShipmentStatusV2.VESSEL_DEPARTED,
    )
  })

  it('returns null for mode-dependent statuses when mode is unknown', () => {
    expect(mapLegacyStatusToV2(OrderStatus.PICKED_UP, null)).toBeNull()
    expect(mapLegacyStatusToV2(OrderStatus.IN_TRANSIT, null)).toBeNull()
  })
})
