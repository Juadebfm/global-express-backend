import { ShipmentStatusV2 } from '../../types/enums'

export const CUSTOMER_TRACKING_STATUSES = [
  'PROCESSING_AT_ORIGIN',
  'IN_TRANSIT',
  'ARRIVED_IN_NIGERIA',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'ON_HOLD',
  'CANCELLED',
  'ACTION_REQUIRED',
] as const

export type CustomerTrackingStatus = (typeof CUSTOMER_TRACKING_STATUSES)[number]

const CUSTOMER_STATUS_LABELS: Record<CustomerTrackingStatus, string> = {
  PROCESSING_AT_ORIGIN: 'Processing at Origin',
  IN_TRANSIT: 'In Transit',
  ARRIVED_IN_NIGERIA: 'Arrived in Nigeria',
  READY_FOR_PICKUP: 'Ready for Pickup',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled',
  ACTION_REQUIRED: 'Action Required',
}

const STATUS_MAP: Record<ShipmentStatusV2, CustomerTrackingStatus> = {
  [ShipmentStatusV2.PREORDER_SUBMITTED]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.WAREHOUSE_RECEIVED]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.AT_ORIGIN_AIRPORT]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.BOARDED_ON_FLIGHT]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.AT_ORIGIN_PORT]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.LOADED_ON_VESSEL]: 'PROCESSING_AT_ORIGIN',
  [ShipmentStatusV2.FLIGHT_DEPARTED]: 'IN_TRANSIT',
  [ShipmentStatusV2.VESSEL_DEPARTED]: 'IN_TRANSIT',
  [ShipmentStatusV2.FLIGHT_LANDED_LAGOS]: 'ARRIVED_IN_NIGERIA',
  [ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT]: 'ARRIVED_IN_NIGERIA',
  [ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS]: 'ARRIVED_IN_NIGERIA',
  [ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE]: 'ARRIVED_IN_NIGERIA',
  [ShipmentStatusV2.READY_FOR_PICKUP]: 'READY_FOR_PICKUP',
  [ShipmentStatusV2.LOCAL_COURIER_ASSIGNED]: 'OUT_FOR_DELIVERY',
  [ShipmentStatusV2.IN_TRANSIT_TO_DESTINATION_CITY]: 'OUT_FOR_DELIVERY',
  [ShipmentStatusV2.OUT_FOR_DELIVERY_DESTINATION_CITY]: 'OUT_FOR_DELIVERY',
  [ShipmentStatusV2.PICKED_UP_COMPLETED]: 'DELIVERED',
  [ShipmentStatusV2.DELIVERED_TO_RECIPIENT]: 'DELIVERED',
  [ShipmentStatusV2.ON_HOLD]: 'ON_HOLD',
  [ShipmentStatusV2.CANCELLED]: 'CANCELLED',
  [ShipmentStatusV2.RESTRICTED_ITEM_REJECTED]: 'ACTION_REQUIRED',
  [ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED]: 'PROCESSING_AT_ORIGIN',
}

export function toCustomerTrackingStatus(
  status: string | null | undefined,
): CustomerTrackingStatus | null {
  if (!status) return null

  const key = status as ShipmentStatusV2
  return STATUS_MAP[key] ?? null
}

export function getCustomerTrackingStatusLabel(
  status: CustomerTrackingStatus | null | undefined,
): string | null {
  if (!status) return null
  return CUSTOMER_STATUS_LABELS[status] ?? null
}
