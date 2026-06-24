import { pgTable, uuid, text, timestamp, uniqueIndex, index, unique } from 'drizzle-orm/pg-core'
import { users } from './users'
import { dispatchBatches } from './dispatch-batches'

/**
 * One row per customer per batch.
 * primaryTrackingNumber is the tracking number of the customer's FIRST verified
 * order placed into this batch — this is the single reference number the customer
 * uses to track all their goods in this batch, regardless of how many orders
 * they add later.
 */
export const batchCustomerSlots = pgTable(
  'batch_customer_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => dispatchBatches.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    primaryTrackingNumber: text('primary_tracking_number').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('batch_customer_slots_unique_idx').on(table.batchId, table.customerId),
    unique('batch_customer_slots_tracking_unique').on(table.batchId, table.primaryTrackingNumber),
    index('batch_customer_slots_batch_id_idx').on(table.batchId),
    index('batch_customer_slots_customer_id_idx').on(table.customerId),
    index('batch_customer_slots_tracking_idx').on(table.primaryTrackingNumber),
  ],
)
