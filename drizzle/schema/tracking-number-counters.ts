import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const trackingNumberCounters = pgTable(
  'tracking_number_counters',
  {
    trackingDateKey: text('tracking_date_key').primaryKey(),
    lastValue: integer('last_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('tracking_number_counters_date_key_check', sql`${table.trackingDateKey} ~ '^[0-9]{8}$'`),
    check('tracking_number_counters_last_value_check', sql`${table.lastValue} >= 0 AND ${table.lastValue} <= 9999`),
  ],
)
