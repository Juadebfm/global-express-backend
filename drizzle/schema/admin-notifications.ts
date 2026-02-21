import { pgTable, uuid, text, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core'

export const adminNotificationTypeEnum = pgEnum('admin_notification_type', [
  'new_customer',
  'new_order',
  'payment_received',
  'payment_failed',
  'new_staff_account',
])

export const adminNotifications = pgTable('admin_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: adminNotificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  // Flexible metadata — e.g. { orderId, customerId, amount, reference }
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  // null = unread
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
