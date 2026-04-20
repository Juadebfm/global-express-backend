import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { orders } from './orders'
import { users } from './users'

export const measurementCheckpointEnum = pgEnum('measurement_checkpoint', [
  'SK_WAREHOUSE',
  'AIRPORT',
  'NIGERIA_OFFICE',
])

export const shipmentMeasurements = pgTable(
  'shipment_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    checkpoint: measurementCheckpointEnum('checkpoint').notNull(),
    measuredWeightKg: numeric('measured_weight_kg', { precision: 10, scale: 3 }).notNull(),
    measuredCbm: numeric('measured_cbm', { precision: 12, scale: 6 }).notNull(),
    deltaFromSkWeightKg: numeric('delta_from_sk_weight_kg', { precision: 10, scale: 3 }),
    deltaFromSkCbm: numeric('delta_from_sk_cbm', { precision: 12, scale: 6 }),
    measuredAt: timestamp('measured_at').notNull().defaultNow(),
    measuredBy: uuid('measured_by').references(() => users.id),
    notes: text('notes'),
    attachmentsCount: integer('attachments_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shipment_measurements_order_checkpoint_unique').on(table.orderId, table.checkpoint),
    index('shipment_measurements_order_id_idx').on(table.orderId),
    index('shipment_measurements_checkpoint_idx').on(table.checkpoint),
    index('shipment_measurements_measured_at_idx').on(table.measuredAt),
  ],
)

