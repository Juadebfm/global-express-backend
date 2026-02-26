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

export const paymentTypeEnum = pgEnum('payment_type', ['online', 'transfer', 'cash'])

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
    // Nullable: null for offline (cash/transfer) payments
    paystackReference: text('paystack_reference').unique(),
    paystackTransactionId: text('paystack_transaction_id'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    paymentType: paymentTypeEnum('payment_type').notNull().default('online'),
    // Staff member who recorded an offline payment; null for online payments
    recordedBy: uuid('recorded_by').references(() => users.id),
    // File URL or reference code for offline payment proof (e.g. bank receipt)
    proofReference: text('proof_reference'),
    note: text('note'),
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
    index('payments_type_idx').on(table.paymentType),
  ],
)
