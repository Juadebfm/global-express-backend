import { eq, desc, count } from 'drizzle-orm'
import { db } from '../config/db'
import { newsletterSubscribers } from '../../drizzle/schema'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'

class NewsletterService {
  async listSubscribers(params: { page: number; limit: number; activeOnly?: boolean }) {
    const offset = getPaginationOffset(params.page, params.limit)

    const where = params.activeOnly ? eq(newsletterSubscribers.isActive, true) : undefined

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(newsletterSubscribers)
        .where(where)
        .orderBy(desc(newsletterSubscribers.subscribedAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(newsletterSubscribers)
        .where(where),
    ])

    return buildPaginatedResult(rows, Number(total), { page: params.page, limit: params.limit })
  }

  async exportSubscribersCsv(activeOnly: boolean): Promise<string> {
    const where = activeOnly ? eq(newsletterSubscribers.isActive, true) : undefined

    const rows = await db
      .select()
      .from(newsletterSubscribers)
      .where(where)
      .orderBy(desc(newsletterSubscribers.subscribedAt))

    const header = 'id,email,is_active,subscribed_at'
    const lines = rows.map((r) =>
      [r.id, r.email, r.isActive, r.subscribedAt.toISOString()].join(','),
    )

    return [header, ...lines].join('\n')
  }

  async deactivateSubscriber(id: string): Promise<void> {
    const [updated] = await db
      .update(newsletterSubscribers)
      .set({ isActive: false })
      .where(eq(newsletterSubscribers.id, id))
      .returning()

    if (!updated) {
      const err = new Error('Subscriber not found') as Error & { statusCode: number }
      err.statusCode = 404
      throw err
    }
  }

  async deleteSubscriber(id: string): Promise<void> {
    const [deleted] = await db
      .delete(newsletterSubscribers)
      .where(eq(newsletterSubscribers.id, id))
      .returning()

    if (!deleted) {
      const err = new Error('Subscriber not found') as Error & { statusCode: number }
      err.statusCode = 404
      throw err
    }
  }
}

export const newsletterService = new NewsletterService()
