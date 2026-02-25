import {
  OrderStatus,
  ShipmentStatusV2,
  TransportMode,
} from '../../types/enums'

export function resolveTransportModeFromShipmentType(
  shipmentType: 'air' | 'ocean' | 'road' | null | undefined,
): TransportMode | null {
  if (shipmentType === 'air') return TransportMode.AIR
  if (shipmentType === 'ocean') return TransportMode.SEA
  return null
}

export function normalizeTransportMode(
  mode: TransportMode | 'air' | 'sea' | null | undefined,
): TransportMode | null {
  if (!mode) return null
  return mode === 'air' ? TransportMode.AIR : TransportMode.SEA
}

export function mapLegacyStatusToV2(
  legacyStatus: OrderStatus,
  transportMode: TransportMode | 'air' | 'sea' | null,
): ShipmentStatusV2 | null {
  switch (legacyStatus) {
    case OrderStatus.PENDING:
      return ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED
    case OrderStatus.PICKED_UP:
      if (!transportMode) return null
      return transportMode === TransportMode.AIR
        ? ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT
        : ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT
    case OrderStatus.IN_TRANSIT:
      if (!transportMode) return null
      return transportMode === TransportMode.AIR
        ? ShipmentStatusV2.FLIGHT_DEPARTED
        : ShipmentStatusV2.VESSEL_DEPARTED
    case OrderStatus.OUT_FOR_DELIVERY:
      return ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE
    case OrderStatus.DELIVERED:
      return ShipmentStatusV2.PICKED_UP_COMPLETED
    case OrderStatus.CANCELLED:
    case OrderStatus.RETURNED:
      return ShipmentStatusV2.CANCELLED
    default:
      return null
  }
}
