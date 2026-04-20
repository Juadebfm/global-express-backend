export enum OrderDirection {
  OUTBOUND = 'outbound',
  INBOUND = 'inbound',
}

export enum UserRole {
  SUPER_ADMIN = 'superadmin',
  STAFF = 'staff',
  USER = 'user',
  SUPPLIER = 'supplier',
}

export enum OrderStatus {
  PENDING = 'pending',
  PICKED_UP = 'picked_up',
  IN_TRANSIT = 'in_transit',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  ABANDONED = 'abandoned',
}

export enum ShipmentType {
  AIR = 'air',
  OCEAN = 'ocean',
  D2D = 'd2d',
}


// V2 refactor enums (introduced in parallel with legacy enums for migration safety)
export enum TransportMode {
  AIR = 'air',
  SEA = 'sea',
}

export enum ShipmentStatusV2 {
  PREORDER_SUBMITTED = 'PREORDER_SUBMITTED',
  AWAITING_WAREHOUSE_RECEIPT = 'AWAITING_WAREHOUSE_RECEIPT',
  WAREHOUSE_RECEIVED = 'WAREHOUSE_RECEIVED',
  WAREHOUSE_VERIFIED_PRICED = 'WAREHOUSE_VERIFIED_PRICED',
  DISPATCHED_TO_ORIGIN_AIRPORT = 'DISPATCHED_TO_ORIGIN_AIRPORT',
  AT_ORIGIN_AIRPORT = 'AT_ORIGIN_AIRPORT',
  BOARDED_ON_FLIGHT = 'BOARDED_ON_FLIGHT',
  FLIGHT_DEPARTED = 'FLIGHT_DEPARTED',
  FLIGHT_LANDED_LAGOS = 'FLIGHT_LANDED_LAGOS',
  DISPATCHED_TO_ORIGIN_PORT = 'DISPATCHED_TO_ORIGIN_PORT',
  AT_ORIGIN_PORT = 'AT_ORIGIN_PORT',
  LOADED_ON_VESSEL = 'LOADED_ON_VESSEL',
  VESSEL_DEPARTED = 'VESSEL_DEPARTED',
  VESSEL_ARRIVED_LAGOS_PORT = 'VESSEL_ARRIVED_LAGOS_PORT',
  CUSTOMS_CLEARED_LAGOS = 'CUSTOMS_CLEARED_LAGOS',
  IN_TRANSIT_TO_LAGOS_OFFICE = 'IN_TRANSIT_TO_LAGOS_OFFICE',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  PICKED_UP_COMPLETED = 'PICKED_UP_COMPLETED',
  LOCAL_COURIER_ASSIGNED = 'LOCAL_COURIER_ASSIGNED',
  IN_TRANSIT_TO_DESTINATION_CITY = 'IN_TRANSIT_TO_DESTINATION_CITY',
  OUT_FOR_DELIVERY_DESTINATION_CITY = 'OUT_FOR_DELIVERY_DESTINATION_CITY',
  DELIVERED_TO_RECIPIENT = 'DELIVERED_TO_RECIPIENT',
  ON_HOLD = 'ON_HOLD',
  CANCELLED = 'CANCELLED',
  RESTRICTED_ITEM_REJECTED = 'RESTRICTED_ITEM_REJECTED',
  RESTRICTED_ITEM_OVERRIDE_APPROVED = 'RESTRICTED_ITEM_OVERRIDE_APPROVED',
}

export enum PaymentCollectionStatus {
  UNPAID = 'UNPAID',
  PAYMENT_IN_PROGRESS = 'PAYMENT_IN_PROGRESS',
  PAID_IN_FULL = 'PAID_IN_FULL',
}

export enum PaymentType {
  ONLINE = 'online',
  TRANSFER = 'transfer',
  CASH = 'cash',
}

export enum DispatchBatchStatus {
  OPEN = 'open',
  CUTOFF_PENDING_APPROVAL = 'cutoff_pending_approval',
  CLOSED = 'closed',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  FINALIZED = 'finalized',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum PricingSource {
  DEFAULT_RATE = 'DEFAULT_RATE',
  CUSTOMER_OVERRIDE = 'CUSTOMER_OVERRIDE',
  MIGRATED_UNVERIFIED = 'MIGRATED_UNVERIFIED',
}

export enum ShipmentPayer {
  USER = 'USER',
  SUPPLIER = 'SUPPLIER',
}

export enum MeasurementCheckpoint {
  SK_WAREHOUSE = 'SK_WAREHOUSE',
  AIRPORT = 'AIRPORT',
  NIGERIA_OFFICE = 'NIGERIA_OFFICE',
}

export enum InvoiceAttachmentType {
  TASK_INVOICE = 'TASK_INVOICE',
  REGULATED_DOCUMENT = 'REGULATED_DOCUMENT',
}

export enum PreferredLanguage {
  EN = 'en',
  KO = 'ko',
}
