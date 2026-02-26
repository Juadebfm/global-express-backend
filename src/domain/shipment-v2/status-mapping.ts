import {
  OrderStatus,
  ShipmentStatusV2,
  TransportMode,
} from '../../types/enums'

export function resolveTransportModeFromShipmentType(
  shipmentType: 'air' | 'ocean' | null | undefined,
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

export function mapV2StatusToLegacy(v2Status: ShipmentStatusV2): OrderStatus {
  switch (v2Status) {
    case ShipmentStatusV2.PREORDER_SUBMITTED:
    case ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT:
    case ShipmentStatusV2.WAREHOUSE_RECEIVED:
    case ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED:
      return OrderStatus.PENDING

    case ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT:
    case ShipmentStatusV2.AT_ORIGIN_AIRPORT:
    case ShipmentStatusV2.BOARDED_ON_FLIGHT:
    case ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT:
    case ShipmentStatusV2.AT_ORIGIN_PORT:
    case ShipmentStatusV2.LOADED_ON_VESSEL:
      return OrderStatus.PICKED_UP

    case ShipmentStatusV2.FLIGHT_DEPARTED:
    case ShipmentStatusV2.FLIGHT_LANDED_LAGOS:
    case ShipmentStatusV2.VESSEL_DEPARTED:
    case ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT:
    case ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS:
      return OrderStatus.IN_TRANSIT

    case ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE:
    case ShipmentStatusV2.READY_FOR_PICKUP:
      return OrderStatus.OUT_FOR_DELIVERY

    case ShipmentStatusV2.PICKED_UP_COMPLETED:
      return OrderStatus.DELIVERED

    case ShipmentStatusV2.ON_HOLD:
    case ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED:
    case ShipmentStatusV2.RESTRICTED_ITEM_REJECTED:
      return OrderStatus.PENDING

    case ShipmentStatusV2.CANCELLED:
      return OrderStatus.CANCELLED

    default:
      return OrderStatus.PENDING
  }
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
