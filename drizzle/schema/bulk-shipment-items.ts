import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { bulkShipments } from './bulk-shipments'
import { orderStatusEnum } from './orders'

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
    status: orderStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('bulk_shipment_items_bulk_id_idx').on(table.bulkShipmentId),
    index('bulk_shipment_items_customer_id_idx').on(table.customerId),
    index('bulk_shipment_items_tracking_number_idx').on(table.trackingNumber),
  ],
)
