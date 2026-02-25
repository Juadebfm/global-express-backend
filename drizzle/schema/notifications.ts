import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { orders } from './orders'

export const notificationTypeEnum = pgEnum('notification_type', [
  'order_status_update',
  'payment_event',
  'system_announcement',
  'admin_alert',
])

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // null = broadcast to all users (isBroadcast must be true)
    userId: uuid('user_id').references(() => users.id),
    // linked order — set for order_status_update and payment_event types
    orderId: uuid('order_id').references(() => orders.id),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    body: text('body').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    // true = system-wide broadcast; userId should be null for broadcasts
    isBroadcast: boolean('is_broadcast').notNull().default(false),
    // Per-user read/saved state — only used for user-specific (non-broadcast) notifications.
    // For broadcasts, per-user state is tracked in notification_reads instead.
    isRead: boolean('is_read').notNull().default(false),
    isSaved: boolean('is_saved').notNull().default(false),
    // null = auto-triggered by system; UUID = admin/superadmin who created it
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_id_idx').on(table.userId),
    index('notifications_created_at_idx').on(table.createdAt),
    index('notifications_type_idx').on(table.type),
    index('notifications_is_broadcast_idx').on(table.isBroadcast),
  ],
)

/**
 * Tracks per-user read/saved state for broadcast notifications.
 * One row is inserted (upserted) when a user reads or saves a broadcast.
 */
export const notificationReads = pgTable(
  'notification_reads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    readAt: timestamp('read_at'),
    isSaved: boolean('is_saved').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // One row per user per broadcast notification
    uniqueIndex('notification_reads_unique_idx').on(table.notificationId, table.userId),
  ],
)
