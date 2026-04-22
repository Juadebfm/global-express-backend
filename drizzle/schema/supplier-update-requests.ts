import { pgEnum, pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const supplierUpdateRequestStatusEnum = pgEnum('supplier_update_request_status', [
  'pending',
  'accepted',
  'rejected',
])

export const supplierUpdateRequests = pgTable(
  'supplier_update_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterUserId: uuid('requester_user_id')
      .notNull()
      .references(() => users.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => users.id),
    status: supplierUpdateRequestStatusEnum('status').notNull().default('pending'),
    proposedFirstName: text('proposed_first_name'),
    proposedLastName: text('proposed_last_name'),
    proposedBusinessName: text('proposed_business_name'),
    proposedPhone: text('proposed_phone'),
    proposedEmail: text('proposed_email'),
    note: text('note'),
    supplierResponseNote: text('supplier_response_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('supplier_update_requests_requester_idx').on(table.requesterUserId),
    index('supplier_update_requests_supplier_idx').on(table.supplierId),
    index('supplier_update_requests_status_idx').on(table.status),
    index('supplier_update_requests_created_at_idx').on(table.createdAt),
  ],
)
