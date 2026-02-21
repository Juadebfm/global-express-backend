import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { orderStatusEnum } from './orders'

export const bulkShipments = pgTable(
  'bulk_shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingNumber: text('tracking_number').notNull().unique(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    status: orderStatusEnum('status').notNull().default('pending'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('bulk_shipments_tracking_number_idx').on(table.trackingNumber),
    index('bulk_shipments_status_idx').on(table.status),
    index('bulk_shipments_created_at_idx').on(table.createdAt),
  ],
)
