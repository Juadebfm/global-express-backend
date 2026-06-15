import { pgEnum, pgTable, text, timestamp, uuid, numeric, integer, date, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { orders } from './orders'
import { shipmentTypeEnum } from './orders'

export const declarationStatusEnum = pgEnum('declaration_status', [
  'pending_review',
  'accepted',
  'rejected',
])

export const supplierDeclarations = pgTable(
  'supplier_declarations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id').notNull().references(() => users.id),

    // Recipient details typed by the supplier (customer in Nigeria)
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    recipientEmail: text('recipient_email'),
    recipientAddress: text('recipient_address'),

    // Goods
    description: text('description').notNull(),
    quantity: integer('quantity'),
    declaredValueUsd: numeric('declared_value_usd', { precision: 12, scale: 2 }).notNull(),
    estimatedWeightKg: numeric('estimated_weight_kg', { precision: 10, scale: 3 }),
    shipmentType: shipmentTypeEnum('shipment_type').notNull(),
    specialPackagingNotes: text('special_packaging_notes'),
    supplierNotes: text('supplier_notes'),
    estimatedArrivalAt: date('estimated_arrival_at'),

    // Review
    status: declarationStatusEnum('status').notNull().default('pending_review'),
    rejectionReason: text('rejection_reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    // After acceptance: the order created from this declaration
    orderId: uuid('order_id').references(() => orders.id),

    // Staff can link to an existing GE customer account
    linkedCustomerId: uuid('linked_customer_id').references(() => users.id),
    linkedBy: uuid('linked_by').references(() => users.id),
    linkedAt: timestamp('linked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('supplier_declarations_supplier_id_idx').on(table.supplierId),
    index('supplier_declarations_status_idx').on(table.status),
    index('supplier_declarations_order_id_idx').on(table.orderId),
    index('supplier_declarations_created_at_idx').on(table.createdAt),
  ],
)
