import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  numeric,
  integer,
  index,
  boolean,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const shipmentStatusV2Enum = pgEnum('shipment_status_v2', [
  'PREORDER_SUBMITTED',
  'AWAITING_WAREHOUSE_RECEIPT',
  'WAREHOUSE_RECEIVED',
  'WAREHOUSE_VERIFIED_PRICED',
  'DISPATCHED_TO_ORIGIN_AIRPORT',
  'AT_ORIGIN_AIRPORT',
  'BOARDED_ON_FLIGHT',
  'FLIGHT_DEPARTED',
  'FLIGHT_LANDED_LAGOS',
  'DISPATCHED_TO_ORIGIN_PORT',
  'AT_ORIGIN_PORT',
  'LOADED_ON_VESSEL',
  'VESSEL_DEPARTED',
  'VESSEL_ARRIVED_LAGOS_PORT',
  'CUSTOMS_CLEARED_LAGOS',
  'IN_TRANSIT_TO_LAGOS_OFFICE',
  'READY_FOR_PICKUP',
  'PICKED_UP_COMPLETED',
  'ON_HOLD',
  'CANCELLED',
  'RESTRICTED_ITEM_REJECTED',
  'RESTRICTED_ITEM_OVERRIDE_APPROVED',
])

export const orderDirectionEnum = pgEnum('order_direction', ['outbound', 'inbound'])

export const shipmentTypeEnum = pgEnum('shipment_type', ['air', 'ocean'])

export const transportModeEnum = pgEnum('transport_mode', ['air', 'sea'])


export const paymentCollectionStatusEnum = pgEnum('payment_collection_status', [
  'UNPAID',
  'PAYMENT_IN_PROGRESS',
  'PAID_IN_FULL',
])

export const pricingSourceEnum = pgEnum('pricing_source', [
  'DEFAULT_RATE',
  'CUSTOMER_OVERRIDE',
  'MANUAL_ADJUSTMENT',
  'MIGRATED_UNVERIFIED',
])

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingNumber: text('tracking_number').notNull().unique(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    // PII fields stored encrypted
    recipientName: text('recipient_name').notNull(),
    recipientAddress: text('recipient_address').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    recipientEmail: text('recipient_email'),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    orderDirection: orderDirectionEnum('order_direction').notNull().default('outbound'),
    weight: numeric('weight', { precision: 10, scale: 2 }),
    declaredValue: numeric('declared_value', { precision: 12, scale: 2 }),
    description: text('description'),
    shipmentType: shipmentTypeEnum('shipment_type'),
    departureDate: timestamp('departure_date'),
    eta: timestamp('eta'),
    transportMode: transportModeEnum('transport_mode'),
    isPreorder: boolean('is_preorder').notNull().default(false),
    statusV2: shipmentStatusV2Enum('status_v2'),
    customerStatusV2: shipmentStatusV2Enum('customer_status_v2'),
    priceCalculatedAt: timestamp('price_calculated_at'),
    priceCalculatedBy: uuid('price_calculated_by').references(() => users.id),
    calculatedChargeUsd: numeric('calculated_charge_usd', { precision: 12, scale: 2 }),
    finalChargeUsd: numeric('final_charge_usd', { precision: 12, scale: 2 }),
    pricingSource: pricingSourceEnum('pricing_source'),
    priceAdjustmentReason: text('price_adjustment_reason'),
    paymentCollectionStatus: paymentCollectionStatusEnum('payment_collection_status')
      .notNull()
      .default('UNPAID'),
    flaggedForAdminReview: boolean('flagged_for_admin_review').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    packageCount: integer('package_count').notNull().default(1),
    // Soft delete — no cascading hard deletes on orders
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('orders_sender_id_idx').on(table.senderId),
    index('orders_status_v2_idx').on(table.statusV2),
    index('orders_transport_mode_idx').on(table.transportMode),
    index('orders_tracking_number_idx').on(table.trackingNumber),
    index('orders_created_at_idx').on(table.createdAt),
  ],
)
