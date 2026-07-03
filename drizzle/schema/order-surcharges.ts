import { pgEnum, pgTable, uuid, text, timestamp, numeric, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { orders } from './orders'

export const surchargeTypeEnum = pgEnum('surcharge_type', ['BAF', 'CAF', 'PSS', 'FSC', 'OTHER'])

export const orderSurcharges = pgTable(
  'order_surcharges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    type: surchargeTypeEnum('type').notNull().default('OTHER'),
    label: text('label').notNull(),
    amountUsd: numeric('amount_usd', { precision: 10, scale: 2 }).notNull(),
    notes: text('notes'),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('order_surcharges_order_id_idx').on(table.orderId),
  ],
)
