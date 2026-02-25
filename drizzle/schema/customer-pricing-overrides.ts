import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { transportModeEnum } from './orders'

export const customerPricingOverrides = pgTable(
  'customer_pricing_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    mode: transportModeEnum('mode').notNull(),
    minWeightKg: numeric('min_weight_kg', { precision: 10, scale: 3 }),
    maxWeightKg: numeric('max_weight_kg', { precision: 10, scale: 3 }),
    rateUsdPerKg: numeric('rate_usd_per_kg', { precision: 12, scale: 2 }),
    flatRateUsdPerCbm: numeric('flat_rate_usd_per_cbm', { precision: 12, scale: 2 }),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('customer_pricing_overrides_customer_id_idx').on(table.customerId),
    index('customer_pricing_overrides_mode_idx').on(table.mode),
    index('customer_pricing_overrides_is_active_idx').on(table.isActive),
    index('customer_pricing_overrides_starts_at_idx').on(table.startsAt),
  ],
)
