import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { orders } from './orders'
import { users } from './users'

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'successful',
  'failed',
  'abandoned',
])

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('NGN'),
    paystackReference: text('paystack_reference').notNull().unique(),
    paystackTransactionId: text('paystack_transaction_id'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    paidAt: timestamp('paid_at'),
    // PCI-DSS: never store card details — only metadata safe to store
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('payments_order_id_idx').on(table.orderId),
    index('payments_user_id_idx').on(table.userId),
    index('payments_status_idx').on(table.status),
  ],
)
