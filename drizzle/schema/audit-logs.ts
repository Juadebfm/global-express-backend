import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { users } from './users'

// Audit logs must be retained for a minimum of 1 year and must never be deletable by any role.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    // Never log PII in these fields
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    // No updatedAt — audit logs are immutable
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_user_id_idx').on(table.userId),
    index('audit_logs_created_at_idx').on(table.createdAt),
    index('audit_logs_resource_type_idx').on(table.resourceType),
  ],
)
