import { pgTable, uuid, text, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'
import { orders } from './orders'

export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
  'open',
  'in_progress',
  'resolved',
  'closed',
])

export const supportTicketCategoryEnum = pgEnum('support_ticket_category', [
  'shipment_inquiry',
  'payment_issue',
  'damaged_goods',
  'document_request',
  'account_issue',
  'general',
])

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketNumber: text('ticket_number').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  category: supportTicketCategoryEnum('category').notNull(),
  status: supportTicketStatusEnum('status').notNull().default('open'),
  subject: text('subject').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supportMessages = pgTable('support_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => supportTickets.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  isInternal: boolean('is_internal').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
