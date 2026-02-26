import { pgTable, uuid, text, timestamp, index, numeric, boolean } from 'drizzle-orm/pg-core'
import { users } from './users'
import { bulkShipments } from './bulk-shipments'
import {
  paymentCollectionStatusEnum,
  pricingSourceEnum,
  shipmentStatusV2Enum,
  transportModeEnum,
} from './orders'

export const bulkShipmentItems = pgTable(
  'bulk_shipment_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bulkShipmentId: uuid('bulk_shipment_id').notNull().references(() => bulkShipments.id),
    customerId: uuid('customer_id').notNull().references(() => users.id),
    trackingNumber: text('tracking_number').notNull().unique(),
    // PII fields stored encrypted
    recipientName: text('recipient_name').notNull(),
    recipientAddress: text('recipient_address').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    recipientEmail: text('recipient_email'),
    weight: text('weight'),
    declaredValue: text('declared_value'),
    description: text('description'),
    statusV2: shipmentStatusV2Enum('status_v2'),
    customerStatusV2: shipmentStatusV2Enum('customer_status_v2'),
    transportMode: transportModeEnum('transport_mode'),
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('bulk_shipment_items_bulk_id_idx').on(table.bulkShipmentId),
    index('bulk_shipment_items_customer_id_idx').on(table.customerId),
    index('bulk_shipment_items_status_v2_idx').on(table.statusV2),
    index('bulk_shipment_items_transport_mode_idx').on(table.transportMode),
    index('bulk_shipment_items_tracking_number_idx').on(table.trackingNumber),
  ],
)
