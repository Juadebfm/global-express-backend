import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  numeric,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
])

export const orderDirectionEnum = pgEnum('order_direction', ['outbound', 'inbound'])

export const shipmentTypeEnum = pgEnum('shipment_type', ['air', 'ocean', 'road'])

export const priorityEnum = pgEnum('priority', ['standard', 'express', 'economy'])

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingNumber: text('tracking_number').notNull().unique(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    // PII fields stored encrypted
    recipientName: text('recipient_name').notNull(),
    recipientAddress: text('recipient_address').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    recipientEmail: text('recipient_email'),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    status: orderStatusEnum('status').notNull().default('pending'),
    orderDirection: orderDirectionEnum('order_direction').notNull().default('outbound'),
    weight: numeric('weight', { precision: 10, scale: 2 }),
    declaredValue: numeric('declared_value', { precision: 12, scale: 2 }),
    description: text('description'),
    shipmentType: shipmentTypeEnum('shipment_type'),
    priority: priorityEnum('priority'),
    departureDate: timestamp('departure_date'),
    eta: timestamp('eta'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    packageCount: integer('package_count').notNull().default(1),
    // Soft delete — no cascading hard deletes on orders
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('orders_sender_id_idx').on(table.senderId),
    index('orders_status_idx').on(table.status),
    index('orders_tracking_number_idx').on(table.trackingNumber),
    index('orders_created_at_idx').on(table.createdAt),
  ],
)
