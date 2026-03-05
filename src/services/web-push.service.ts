import webpush from 'web-push'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { pushSubscriptions, users } from '../../drizzle/schema'
import { env } from '../config/env'
import { UserRole } from '../types/enums'

// Configure VAPID once at startup (no-op if keys are not set)
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  )
}

function isConfigured(): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  type?: string
  metadata?: Record<string, unknown>
}

export class WebPushService {
  /**
   * Subscribe a user's browser to push notifications.
   * Upserts — if the same endpoint already exists for the user, it's a no-op.
   */
  async subscribe(input: {
    userId: string
    endpoint: string
    keys: { p256dh: string; auth: string }
    deviceLabel?: string
  }) {
    await db
      .insert(pushSubscriptions)
      .values({
        userId: input.userId,
        endpoint: input.endpoint,
        keys: input.keys,
        deviceLabel: input.deviceLabel ?? null,
      })
      .onConflictDoNothing()
  }

  /**
   * Remove a specific push subscription.
   */
  async unsubscribe(userId: string, endpoint: string) {
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      )
  }

  /**
   * Send a push notification to all subscriptions for a specific user.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!isConfigured()) return

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))

    await this.sendToSubscriptions(subs, payload)
  }

  /**
   * Send a push notification to all admin+ users.
   */
  async sendToAdmins(payload: PushPayload): Promise<void> {
    if (!isConfigured()) return

    const adminUserIds = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.role, [UserRole.SUPERADMIN, UserRole.ADMIN]),
          eq(users.isActive, true),
        ),
      )

    if (adminUserIds.length === 0) return

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(
        inArray(
          pushSubscriptions.userId,
          adminUserIds.map((u) => u.id),
        ),
      )

    await this.sendToSubscriptions(subs, payload)
  }

  private async sendToSubscriptions(
    subs: (typeof pushSubscriptions.$inferSelect)[],
    payload: PushPayload,
  ) {
    const jsonPayload = JSON.stringify(payload)

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys as { p256dh: string; auth: string },
          },
          jsonPayload,
        ),
      ),
    )

    // Clean up expired/invalid subscriptions (410 Gone or 404)
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        const statusCode = (result.reason as { statusCode?: number })?.statusCode
        if (statusCode === 410 || statusCode === 404) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, subs[i].id))
        }
      }
    }
  }
}

export const webPushService = new WebPushService()
