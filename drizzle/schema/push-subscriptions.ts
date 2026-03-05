import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './users'

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The full PushSubscription object from the browser
    endpoint: text('endpoint').notNull(),
    keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
    // Optional device label for management UI (e.g. "Chrome on MacBook")
    deviceLabel: text('device_label'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // One subscription per endpoint per user
    uniqueIndex('push_sub_user_endpoint_idx').on(table.userId, table.endpoint),
  ],
)
