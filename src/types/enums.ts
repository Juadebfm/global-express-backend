export enum OrderDirection {
  OUTBOUND = 'outbound',
  INBOUND = 'inbound',
}

export enum UserRole {
  SUPERADMIN = 'superadmin',
  ADMIN = 'admin',
  STAFF = 'staff',
  USER = 'user',
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
