import { pgTable, text, uuid, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
    index('idempotency_keys_user_id_idx').on(table.userId),
  ],
)
