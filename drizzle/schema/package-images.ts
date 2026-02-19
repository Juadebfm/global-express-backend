import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { orders } from './orders'
import { users } from './users'

export const packageImages = pgTable(
  'package_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    r2Key: text('r2_key').notNull(),
    r2Url: text('r2_url').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('package_images_order_id_idx').on(table.orderId)],
)
