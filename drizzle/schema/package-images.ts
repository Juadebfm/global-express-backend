import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { orders } from './orders'
import { users } from './users'
import { bulkShipmentItems } from './bulk-shipment-items'

export const packageImages = pgTable(
  'package_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // One of orderId or bulkItemId must be set — nullable to support both
    orderId: uuid('order_id').references(() => orders.id),
    bulkItemId: uuid('bulk_item_id').references(() => bulkShipmentItems.id),
    r2Key: text('r2_key').notNull(),
    r2Url: text('r2_url').notNull(),
    uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('package_images_order_id_idx').on(table.orderId),
    index('package_images_bulk_item_id_idx').on(table.bulkItemId),
  ],
)
