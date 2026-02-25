import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core'
import { orders } from './orders'
import { bulkShipmentItems } from './bulk-shipment-items'
import { users } from './users'

export const orderPackages = pgTable(
  'order_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // One of orderId or bulkItemId must be set by application logic.
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    bulkItemId: uuid('bulk_item_id').references(() => bulkShipmentItems.id, {
      onDelete: 'cascade',
    }),
    description: text('description'),
    itemType: text('item_type'),
    quantity: integer('quantity').notNull().default(1),
    lengthCm: numeric('length_cm', { precision: 10, scale: 2 }),
    widthCm: numeric('width_cm', { precision: 10, scale: 2 }),
    heightCm: numeric('height_cm', { precision: 10, scale: 2 }),
    weightKg: numeric('weight_kg', { precision: 10, scale: 3 }),
    cbm: numeric('cbm', { precision: 12, scale: 6 }),
    isRestricted: boolean('is_restricted').notNull().default(false),
    restrictedReason: text('restricted_reason'),
    restrictedOverrideApproved: boolean('restricted_override_approved')
      .notNull()
      .default(false),
    restrictedOverrideReason: text('restricted_override_reason'),
    restrictedOverrideBy: uuid('restricted_override_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('order_packages_order_id_idx').on(table.orderId),
    index('order_packages_bulk_item_id_idx').on(table.bulkItemId),
    index('order_packages_item_type_idx').on(table.itemType),
  ],
)
