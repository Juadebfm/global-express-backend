import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Security event log (ASVS V7.2.1). Distinct from `audit_logs`, which records
 * administrative actions; this table is for security-relevant events that a
 * SOC analyst would query.
 *
 * Examples: login success/failure/lockout, MFA verify failure, recovery-code
 * use, token revocation, password reset OTP send/verify/complete, account
 * erasure.
 */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('security_events_user_id_idx').on(table.userId),
    index('security_events_event_type_idx').on(table.eventType),
    index('security_events_created_at_idx').on(table.createdAt),
  ],
)
