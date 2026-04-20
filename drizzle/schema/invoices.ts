import { pgTable, uuid, text, timestamp, numeric, index, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './users'
import { orders } from './orders'
import { shipmentPayerEnum } from './orders'

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'finalized',
  'paid',
  'cancelled',
])

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    invoiceNumber: text('invoice_number').notNull().unique(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    shipmentPayer: shipmentPayerEnum('shipment_payer').notNull().default('USER'),
    billToUserId: uuid('bill_to_user_id').references(() => users.id),
    billToSupplierId: uuid('bill_to_supplier_id').references(() => users.id),
    totalUsd: numeric('total_usd', { precision: 12, scale: 2 }).notNull().default('0'),
    fxRateNgnPerUsd: numeric('fx_rate_ngn_per_usd', { precision: 12, scale: 4 }).notNull().default('1500'),
    totalNgn: numeric('total_ngn', { precision: 14, scale: 2 }).notNull().default('0'),
    finalizedAt: timestamp('finalized_at'),
    finalizedBy: uuid('finalized_by').references(() => users.id),
    paidAt: timestamp('paid_at'),
    paidBy: uuid('paid_by').references(() => users.id),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_order_id_unique').on(table.orderId),
    index('invoices_invoice_number_idx').on(table.invoiceNumber),
    index('invoices_status_idx').on(table.status),
    index('invoices_shipment_payer_idx').on(table.shipmentPayer),
    index('invoices_bill_to_user_id_idx').on(table.billToUserId),
    index('invoices_bill_to_supplier_id_idx').on(table.billToSupplierId),
    index('invoices_created_at_idx').on(table.createdAt),
  ],
)
