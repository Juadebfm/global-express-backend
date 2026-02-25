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

export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    mode: transportModeEnum('mode').notNull(),
    minWeightKg: numeric('min_weight_kg', { precision: 10, scale: 3 }),
    maxWeightKg: numeric('max_weight_kg', { precision: 10, scale: 3 }),
    rateUsdPerKg: numeric('rate_usd_per_kg', { precision: 12, scale: 2 }),
    flatRateUsdPerCbm: numeric('flat_rate_usd_per_cbm', { precision: 12, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    effectiveFrom: timestamp('effective_from'),
    effectiveTo: timestamp('effective_to'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('pricing_rules_mode_idx').on(table.mode),
    index('pricing_rules_is_active_idx').on(table.isActive),
    index('pricing_rules_effective_from_idx').on(table.effectiveFrom),
  ],
)
