import { eq, isNull, and, desc, sql } from 'drizzle-orm'
import { db } from '../config/db'
import { adminNotifications, users } from '../../drizzle/schema'
import { decrypt } from '../utils/encryption'
import { sendAccountAlertEmail } from '../notifications/email'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'
import { UserRole } from '../types/enums'

export type AdminNotificationType =
  | 'new_customer'
  | 'new_order'
  | 'payment_received'
  | 'payment_failed'
  | 'new_staff_account'

export interface NotifyInput {
  type: AdminNotificationType
  title: string
  body: string
  metadata?: Record<string, unknown>
}

export class AdminNotificationsService {
  /**
   * Creates a notification record in the DB and fires an email to every active superadmin.
   * Called fire-and-forget — errors are logged but never thrown to the caller.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      // 1. Persist in-app notification
      await db.insert(adminNotifications).values({
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata ?? null,
      })

      // 2. Email all active superadmins
      const superadmins = await db
        .select({ email: users.email })
        .from(users)
        .where(
          and(
            eq(users.role, UserRole.SUPERADMIN),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        )

      await Promise.allSettled(
        superadmins.map((sa) =>
          sendAccountAlertEmail({
            to: decrypt(sa.email),
            subject: `[Global Express] ${input.title}`,
            message: input.body,
          }),
        ),
      )
    } catch (err) {
      // Never crash the caller — notifications are best-effort
      console.error('[AdminNotifications] Failed to send notification:', err)
    }
  }

  async listNotifications(params: PaginationParams & { unreadOnly?: boolean }) {
    const offset = getPaginationOffset(params.page, params.limit)

    const baseWhere = params.unreadOnly ? isNull(adminNotifications.readAt) : undefined

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(adminNotifications)
        .where(baseWhere)
        .orderBy(desc(adminNotifications.createdAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(adminNotifications)
        .where(baseWhere),
    ])

    const total = countResult[0]?.count ?? 0
    return buildPaginatedResult(data, total, params)
  }

  async markAsRead(id: string) {
    const [updated] = await db
      .update(adminNotifications)
      .set({ readAt: new Date() })
      .where(and(eq(adminNotifications.id, id), isNull(adminNotifications.readAt)))
      .returning()

    return updated ?? null
  }

  async markAllAsRead() {
    await db
      .update(adminNotifications)
      .set({ readAt: new Date() })
      .where(isNull(adminNotifications.readAt))
  }

  async getUnreadCount(): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminNotifications)
      .where(isNull(adminNotifications.readAt))

    return result?.count ?? 0
  }
}

export const adminNotificationsService = new AdminNotificationsService()
