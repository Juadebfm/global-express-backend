import { eq, and, or, desc, sql, isNull, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { notifications, notificationReads } from '../../drizzle/schema'
import { broadcastToUser, broadcastToAll } from '../websocket/handlers'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'

export type NotificationType =
  | 'order_status_update'
  | 'payment_event'
  | 'system_announcement'
  | 'admin_alert'

export interface CreateNotificationInput {
  userId: string
  orderId?: string
  type: NotificationType
  title: string
  subtitle?: string
  body: string
  metadata?: Record<string, unknown>
  createdBy?: string
}

export interface CreateBroadcastInput {
  type: NotificationType
  title: string
  subtitle?: string
  body: string
  metadata?: Record<string, unknown>
  createdBy: string
}

export class NotificationsService {
  /**
   * Creates a notification for a specific user and pushes it via WebSocket.
   * Called fire-and-forget in most cases — errors are caught and logged.
   */
  async create(input: CreateNotificationInput) {
    const [notification] = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        orderId: input.orderId ?? null,
        type: input.type,
        title: input.title,
        subtitle: input.subtitle ?? null,
        body: input.body,
        metadata: input.metadata ?? null,
        isBroadcast: false,
        isRead: false,
        isSaved: false,
        createdBy: input.createdBy ?? null,
      })
      .returning()

    // Push real-time to user if connected
    broadcastToUser(input.userId, {
      type: 'notification:new',
      data: this.formatForUser(notification, false, false),
    })

    return notification
  }

  /**
   * Creates a system-wide broadcast notification and pushes it to all connected clients.
   * Only admin/superadmin can call this.
   */
  async createBroadcast(input: CreateBroadcastInput) {
    const [notification] = await db
      .insert(notifications)
      .values({
        userId: null,
        orderId: null,
        type: input.type,
        title: input.title,
        subtitle: input.subtitle ?? null,
        body: input.body,
        metadata: input.metadata ?? null,
        isBroadcast: true,
        isRead: false,
        isSaved: false,
        createdBy: input.createdBy,
      })
      .returning()

    // Push to all connected WebSocket clients
    broadcastToAll({
      type: 'notification:broadcast',
      data: this.formatForUser(notification, false, false),
    })

    return notification
  }

  /**
   * Returns paginated notifications for a user: personal notifications + all broadcasts.
   * For broadcasts, isRead/isSaved state is read from notification_reads.
   */
  async listForUser(userId: string, params: PaginationParams) {
    const offset = getPaginationOffset(params.page, params.limit)

    // Count total (personal + broadcasts that the user hasn't deleted)
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId),
        ),
      )
      .where(
        and(
          sql`(${notifications.userId} = ${userId} OR ${notifications.isBroadcast} = true)`,
          or(isNull(notificationReads.isDeleted), eq(notificationReads.isDeleted, false)),
        ),
      )

    const total = countResult?.count ?? 0

    // Fetch paginated rows, joining notification_reads for broadcast state
    const rows = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        orderId: notifications.orderId,
        type: notifications.type,
        title: notifications.title,
        subtitle: notifications.subtitle,
        body: notifications.body,
        metadata: notifications.metadata,
        isBroadcast: notifications.isBroadcast,
        // For personal: use column values. For broadcasts: use notification_reads row.
        isRead: notifications.isRead,
        isSaved: notifications.isSaved,
        createdBy: notifications.createdBy,
        createdAt: notifications.createdAt,
        // Broadcast-specific read state for THIS user
        readReadAt: notificationReads.readAt,
        readIsSaved: notificationReads.isSaved,
      })
      .from(notifications)
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId),
        ),
      )
      .where(
        and(
          sql`(${notifications.userId} = ${userId} OR ${notifications.isBroadcast} = true)`,
          or(isNull(notificationReads.isDeleted), eq(notificationReads.isDeleted, false)),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(params.limit)
      .offset(offset)

    const data = rows.map((row) => {
      if (row.isBroadcast) {
        return this.formatForUser(row, !!row.readReadAt, row.readIsSaved ?? false)
      }
      return this.formatForUser(row, row.isRead, row.isSaved)
    })

    return buildPaginatedResult(data, total, params)
  }

  /**
   * Marks a notification as read for a user.
   * Personal: updates isRead on the notification row.
   * Broadcast: upserts a notification_reads row.
   */
  async markRead(notificationId: string, userId: string): Promise<boolean> {
    const [notification] = await db
      .select({ id: notifications.id, userId: notifications.userId, isBroadcast: notifications.isBroadcast })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1)

    if (!notification) return false

    if (notification.isBroadcast) {
      // Upsert into notification_reads
      await db
        .insert(notificationReads)
        .values({ notificationId, userId, readAt: new Date() })
        .onConflictDoUpdate({
          target: [notificationReads.notificationId, notificationReads.userId],
          set: { readAt: new Date() },
        })
    } else {
      // Must be the owner
      if (notification.userId !== userId) return false
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, notificationId))
    }

    return true
  }

  /**
   * Toggles saved state for a notification.
   * Personal: flips isSaved on the notification row.
   * Broadcast: upserts a notification_reads row with toggled isSaved.
   */
  async toggleSaved(notificationId: string, userId: string): Promise<boolean> {
    const [notification] = await db
      .select({ id: notifications.id, userId: notifications.userId, isBroadcast: notifications.isBroadcast, isSaved: notifications.isSaved })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1)

    if (!notification) return false

    if (notification.isBroadcast) {
      // Upsert — toggle isSaved
      const [existing] = await db
        .select({ isSaved: notificationReads.isSaved })
        .from(notificationReads)
        .where(
          and(
            eq(notificationReads.notificationId, notificationId),
            eq(notificationReads.userId, userId),
          ),
        )
        .limit(1)

      const newSaved = !(existing?.isSaved ?? false)
      await db
        .insert(notificationReads)
        .values({ notificationId, userId, isSaved: newSaved })
        .onConflictDoUpdate({
          target: [notificationReads.notificationId, notificationReads.userId],
          set: { isSaved: newSaved },
        })
    } else {
      if (notification.userId !== userId) return false
      await db
        .update(notifications)
        .set({ isSaved: !notification.isSaved })
        .where(eq(notifications.id, notificationId))
    }

    return true
  }

  /**
   * Returns the unread notification count for a user (personal + broadcasts not yet read).
   */
  async getUnreadCount(userId: string): Promise<number> {
    // Personal unread
    const [personal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))

    // Unread broadcasts (no notification_reads row, or readAt is null)
    const [broadcasts] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId),
        ),
      )
      .where(
        and(
          eq(notifications.isBroadcast, true),
          isNull(notificationReads.readAt),
          or(isNull(notificationReads.isDeleted), eq(notificationReads.isDeleted, false)),
        ),
      )

    return (personal?.count ?? 0) + (broadcasts?.count ?? 0)
  }

  /**
   * Deletes a single notification for a user.
   * Personal notifications are hard-deleted (must be the owner).
   * Broadcasts are soft-deleted per-user via notification_reads.isDeleted.
   */
  async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const [notification] = await db
      .select({ id: notifications.id, userId: notifications.userId, isBroadcast: notifications.isBroadcast })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1)

    if (!notification) return false

    if (notification.isBroadcast) {
      await db
        .insert(notificationReads)
        .values({ notificationId, userId, isDeleted: true })
        .onConflictDoUpdate({
          target: [notificationReads.notificationId, notificationReads.userId],
          set: { isDeleted: true },
        })
    } else {
      if (notification.userId !== userId) return false
      await db.delete(notifications).where(eq(notifications.id, notificationId))
    }

    return true
  }

  /**
   * Deletes multiple notifications for a user. Returns count of successfully deleted items.
   */
  async bulkDeleteNotifications(notificationIds: string[], userId: string): Promise<number> {
    // Fetch all target notifications in one query
    const rows = await db
      .select({ id: notifications.id, userId: notifications.userId, isBroadcast: notifications.isBroadcast })
      .from(notifications)
      .where(inArray(notifications.id, notificationIds))

    const personalIds = rows
      .filter((n) => !n.isBroadcast && n.userId === userId)
      .map((n) => n.id)
    const broadcastIds = rows.filter((n) => n.isBroadcast).map((n) => n.id)

    const ops: Promise<unknown>[] = []

    if (personalIds.length > 0) {
      ops.push(db.delete(notifications).where(inArray(notifications.id, personalIds)))
    }

    if (broadcastIds.length > 0) {
      // Upsert isDeleted=true for each broadcast (one per user-notification pair)
      ops.push(
        ...broadcastIds.map((notificationId) =>
          db
            .insert(notificationReads)
            .values({ notificationId, userId, isDeleted: true })
            .onConflictDoUpdate({
              target: [notificationReads.notificationId, notificationReads.userId],
              set: { isDeleted: true },
            }),
        ),
      )
    }

    await Promise.all(ops)
    return personalIds.length + broadcastIds.length
  }

  private formatForUser(
    row: {
      id: string
      userId: string | null
      orderId: string | null
      type: string
      title: string
      subtitle: string | null
      body: string
      metadata: Record<string, unknown> | null
      isBroadcast: boolean
      createdBy: string | null
      createdAt: Date | string
    },
    isRead: boolean,
    isSaved: boolean,
  ) {
    return {
      id: row.id,
      userId: row.userId,
      orderId: row.orderId,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      body: row.body,
      metadata: row.metadata,
      isBroadcast: row.isBroadcast,
      isRead,
      isSaved,
      createdBy: row.createdBy,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    }
  }
}

export const notificationsService = new NotificationsService()

/**
 * Convenience wrapper — creates a user notification and swallows errors.
 * Use for fire-and-forget calls from order/payment flows.
 */
export async function notifyUser(input: CreateNotificationInput): Promise<void> {
  try {
    await notificationsService.create(input)
  } catch (err) {
    console.error('[Notifications] Failed to create notification:', err)
  }
}
