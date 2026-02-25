import {
  ShipmentStatusV2,
  TransportMode,
} from '../../types/enums'

const COMMON_FLOW: readonly ShipmentStatusV2[] = [
  ShipmentStatusV2.PREORDER_SUBMITTED,
  ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT,
  ShipmentStatusV2.WAREHOUSE_RECEIVED,
  ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
]

const AIR_FLOW: readonly ShipmentStatusV2[] = [
  ...COMMON_FLOW,
  ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT,
  ShipmentStatusV2.AT_ORIGIN_AIRPORT,
  ShipmentStatusV2.BOARDED_ON_FLIGHT,
  ShipmentStatusV2.FLIGHT_DEPARTED,
  ShipmentStatusV2.FLIGHT_LANDED_LAGOS,
  ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS,
  ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
  ShipmentStatusV2.READY_FOR_PICKUP,
  ShipmentStatusV2.PICKED_UP_COMPLETED,
]

const SEA_FLOW: readonly ShipmentStatusV2[] = [
  ...COMMON_FLOW,
  ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT,
  ShipmentStatusV2.AT_ORIGIN_PORT,
  ShipmentStatusV2.LOADED_ON_VESSEL,
  ShipmentStatusV2.VESSEL_DEPARTED,
  ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT,
  ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS,
  ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
  ShipmentStatusV2.READY_FOR_PICKUP,
  ShipmentStatusV2.PICKED_UP_COMPLETED,
]

const EXCEPTION_STATUSES = new Set<ShipmentStatusV2>([
  ShipmentStatusV2.ON_HOLD,
  ShipmentStatusV2.CANCELLED,
  ShipmentStatusV2.RESTRICTED_ITEM_REJECTED,
  ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED,
])

function getFlow(mode: TransportMode): readonly ShipmentStatusV2[] {
  return mode === TransportMode.AIR ? AIR_FLOW : SEA_FLOW
}

export function isExceptionStatus(status: ShipmentStatusV2): boolean {
  return EXCEPTION_STATUSES.has(status)
}

export function canTransitionSequentially(
  mode: TransportMode,
  currentStatus: ShipmentStatusV2 | null,
  nextStatus: ShipmentStatusV2,
): boolean {
  if (isExceptionStatus(nextStatus)) return true
  if (currentStatus && isExceptionStatus(currentStatus)) return true

  const flow = getFlow(mode)
  const nextIdx = flow.indexOf(nextStatus)
  if (nextIdx < 0) return false

  if (!currentStatus) return nextStatus === flow[0]

  const currentIdx = flow.indexOf(currentStatus)
  if (currentIdx < 0) return false

  return nextIdx === currentIdx + 1
}

export function getInitialStatusForMode(mode: TransportMode): ShipmentStatusV2 {
  const flow = getFlow(mode)
  return flow[0]
}
