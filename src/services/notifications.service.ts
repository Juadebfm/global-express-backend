import { eq, and, or, desc, sql, isNull, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { notifications, notificationReads, users } from '../../drizzle/schema'
import { broadcastToUser, broadcastToAll, connectedClients } from '../websocket/handlers'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'
import { UserRole } from '../types/enums'
import { decrypt } from '../utils/encryption'
import { sendAccountAlertEmail } from '../notifications/email'
import { webPushService } from './web-push.service'

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'order_status_update'
  | 'payment_event'
  | 'system_announcement'
  | 'admin_alert'
  | 'new_customer'
  | 'new_order'
  | 'payment_received'
  | 'payment_failed'
  | 'new_staff_account'
  | 'staff_onboarding_complete'

/** Input for creating a notification targeted at a specific user. */
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

/** Input for creating a system-wide broadcast (visible to all roles). */
export interface CreateBroadcastInput {
  type: NotificationType
  title: string
  subtitle?: string
  body: string
  metadata?: Record<string, unknown>
  createdBy: string
}

/** Input for creating a role-targeted notification (e.g. admin feed). */
export interface CreateRoleNotificationInput {
  targetRole: UserRole
  type: NotificationType
  title: string
  subtitle?: string
  body: string
  metadata?: Record<string, unknown>
  createdBy?: string
}

// ─── Role hierarchy helper ────────────────────────────────────────────────────

const ROLE_HIERARCHY: UserRole[] = [
  UserRole.USER,
  UserRole.STAFF,
  UserRole.ADMIN,
  UserRole.SUPERADMIN,
]

/** Returns all targetRole values this user's role can see. */
function getVisibleTargetRoles(userRole: UserRole): UserRole[] {
  const level = ROLE_HIERARCHY.indexOf(userRole)
  if (level < 0) return []
  return ROLE_HIERARCHY.slice(0, level + 1)
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class NotificationsService {
  /**
   * Creates a notification for a specific user and pushes it via WebSocket.
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

    broadcastToUser(input.userId, {
      type: 'notification:new',
      data: this.formatForUser(notification, false, false),
    })

    return notification
  }

  /**
   * Creates a system-wide broadcast notification and pushes it to all connected clients.
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

    broadcastToAll({
      type: 'notification:broadcast',
      data: this.formatForUser(notification, false, false),
    })

    return notification
  }

  /**
   * Creates a role-targeted notification visible to users with the given role or above.
   * Also sends email alerts to superadmins and browser push to matching roles.
   * Called fire-and-forget — errors are logged but never thrown to the caller.
   */
  async notifyRole(input: CreateRoleNotificationInput): Promise<void> {
    try {
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
          isBroadcast: false,
          targetRole: input.targetRole,
          isRead: false,
          isSaved: false,
          createdBy: input.createdBy ?? null,
        })
        .returning()

      // Push via WebSocket to all connected users at or above the target role
      const visibleRoles = ROLE_HIERARCHY.slice(ROLE_HIERARCHY.indexOf(input.targetRole))
      const matchingUsers = await db
        .select({ id: users.id, email: users.email, role: users.role })
        .from(users)
        .where(
          and(
            inArray(users.role, visibleRoles),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        )

      const wsPayload = {
        type: 'notification:new',
        data: this.formatForUser(notification, false, false),
      }

      for (const user of matchingUsers) {
        if (connectedClients.has(user.id)) {
          broadcastToUser(user.id, wsPayload)
        }
      }

      // Browser push to matching roles
      webPushService
        .sendToAdmins({
          title: input.title,
          body: input.body,
          type: input.type,
          url: '/notifications',
          metadata: input.metadata,
        })
        .catch((err) => console.error('[WebPush] Failed:', err))

      // Email all active superadmins
      const superadminEmails = matchingUsers
        .filter((u) => u.role === UserRole.SUPERADMIN)
        .map((sa) => decrypt(sa.email))

      await Promise.allSettled(
        superadminEmails.map((email) =>
          sendAccountAlertEmail({
            to: email,
            subject: `[Global Express] ${input.title}`,
            message: input.body,
          }),
        ),
      )
    } catch (err) {
      console.error('[Notifications] Failed to send role notification:', err)
    }
  }

  /**
   * Returns paginated notifications for a user based on their role.
   *
   * Visibility rules:
   *   - Personal notifications (userId = this user)
   *   - Broadcasts (isBroadcast = true)
   *   - Role-targeted (targetRole in visible roles for the user's role)
   *
   * Per-user read/saved/deleted state for shared notifications (broadcasts + role-targeted)
   * is tracked in notification_reads.
   */
  async listForUser(userId: string, userRole: UserRole, params: PaginationParams) {
    const offset = getPaginationOffset(params.page, params.limit)
    const visibleRoles = getVisibleTargetRoles(userRole)

    const visibilityFilter = this.buildVisibilityFilter(userId, visibleRoles)

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
          visibilityFilter,
          or(isNull(notificationReads.isDeleted), eq(notificationReads.isDeleted, false)),
        ),
      )

    const total = countResult?.count ?? 0

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
        targetRole: notifications.targetRole,
        isRead: notifications.isRead,
        isSaved: notifications.isSaved,
        createdBy: notifications.createdBy,
        createdAt: notifications.createdAt,
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
          visibilityFilter,
          or(isNull(notificationReads.isDeleted), eq(notificationReads.isDeleted, false)),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(params.limit)
      .offset(offset)

    const data = rows.map((row) => {
      // Shared notifications (broadcast or role-targeted) use notification_reads for per-user state
      if (row.isBroadcast || row.targetRole) {
        return this.formatForUser(row, !!row.readReadAt, row.readIsSaved ?? false)
      }
      return this.formatForUser(row, row.isRead, row.isSaved)
    })

    return buildPaginatedResult(data, total, params)
  }

  /**
   * Marks a notification as read for a user.
   * Personal: updates isRead on the row. Shared: upserts notification_reads.
   */
  async markRead(notificationId: string, userId: string): Promise<boolean> {
    const [notification] = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        isBroadcast: notifications.isBroadcast,
        targetRole: notifications.targetRole,
      })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1)

    if (!notification) return false

    if (notification.isBroadcast || notification.targetRole) {
      await db
        .insert(notificationReads)
        .values({ notificationId, userId, readAt: new Date() })
        .onConflictDoUpdate({
          target: [notificationReads.notificationId, notificationReads.userId],
          set: { readAt: new Date() },
        })
    } else {
      if (notification.userId !== userId) return false
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, notificationId))
    }

    return true
  }

  /**
   * Marks all notifications as read for a user (personal + shared).
   */
  async markAllRead(userId: string, userRole: UserRole): Promise<void> {
    const visibleRoles = getVisibleTargetRoles(userRole)

    // Mark personal notifications as read
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))

    // Find unread shared notifications (broadcasts + role-targeted) that this user can see
    const sharedUnread = await db
      .select({ id: notifications.id })
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
          or(
            eq(notifications.isBroadcast, true),
            visibleRoles.length > 0
              ? inArray(notifications.targetRole, visibleRoles)
              : sql`false`,
          ),
          isNull(notificationReads.readAt),
          or(isNull(notificationReads.isDeleted), eq(notificationReads.isDeleted, false)),
        ),
      )

    if (sharedUnread.length > 0) {
      await Promise.all(
        sharedUnread.map((n) =>
          db
            .insert(notificationReads)
            .values({ notificationId: n.id, userId, readAt: new Date() })
            .onConflictDoUpdate({
              target: [notificationReads.notificationId, notificationReads.userId],
              set: { readAt: new Date() },
            }),
        ),
      )
    }
  }

  /**
   * Toggles saved state for a notification.
   */
  async toggleSaved(notificationId: string, userId: string): Promise<boolean> {
    const [notification] = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        isBroadcast: notifications.isBroadcast,
        targetRole: notifications.targetRole,
        isSaved: notifications.isSaved,
      })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1)

    if (!notification) return false

    if (notification.isBroadcast || notification.targetRole) {
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
   * Returns the unread notification count for a user.
   */
  async getUnreadCount(userId: string, userRole: UserRole): Promise<number> {
    const visibleRoles = getVisibleTargetRoles(userRole)

    // Personal unread
    const [personal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))

    // Unread shared (broadcasts + role-targeted)
    const sharedFilter = or(
      eq(notifications.isBroadcast, true),
      visibleRoles.length > 0
        ? inArray(notifications.targetRole, visibleRoles)
        : sql`false`,
    )

    const [shared] = await db
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
          sharedFilter,
          isNull(notificationReads.readAt),
          or(isNull(notificationReads.isDeleted), eq(notificationReads.isDeleted, false)),
        ),
      )

    return (personal?.count ?? 0) + (shared?.count ?? 0)
  }

  /**
   * Deletes a single notification for a user.
   * Personal: hard-delete (must be owner). Shared: soft-delete via notification_reads.
   */
  async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const [notification] = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        isBroadcast: notifications.isBroadcast,
        targetRole: notifications.targetRole,
      })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1)

    if (!notification) return false

    if (notification.isBroadcast || notification.targetRole) {
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
   * Deletes multiple notifications for a user. Returns count processed.
   */
  async bulkDeleteNotifications(notificationIds: string[], userId: string): Promise<number> {
    const rows = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        isBroadcast: notifications.isBroadcast,
        targetRole: notifications.targetRole,
      })
      .from(notifications)
      .where(inArray(notifications.id, notificationIds))

    const personalIds = rows
      .filter((n) => !n.isBroadcast && !n.targetRole && n.userId === userId)
      .map((n) => n.id)
    const sharedIds = rows
      .filter((n) => n.isBroadcast || n.targetRole)
      .map((n) => n.id)

    const ops: Promise<unknown>[] = []

    if (personalIds.length > 0) {
      ops.push(db.delete(notifications).where(inArray(notifications.id, personalIds)))
    }

    if (sharedIds.length > 0) {
      ops.push(
        ...sharedIds.map((notificationId) =>
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
    return personalIds.length + sharedIds.length
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Builds the WHERE clause for notification visibility.
   * A user sees: personal (userId=me) OR broadcast OR role-targeted (if role matches).
   */
  private buildVisibilityFilter(userId: string, visibleRoles: UserRole[]) {
    const conditions = [
      sql`${notifications.userId} = ${userId}`,
      sql`${notifications.isBroadcast} = true`,
    ]

    if (visibleRoles.length > 0) {
      const roleList = visibleRoles.map((r) => `'${r}'`).join(', ')
      conditions.push(sql.raw(`${notifications.targetRole.name} IN (${roleList})`))
    }

    return sql`(${sql.join(conditions, sql` OR `)})`
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
