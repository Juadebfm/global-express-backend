import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const revokedTokens = pgTable(
  'revoked_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jti: text('jti').notNull().unique(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('revoked_tokens_expires_at_idx').on(table.expiresAt),
  ],
)
