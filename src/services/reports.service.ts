import { sql, gte, lte, and } from 'drizzle-orm'
import { db } from '../config/db'
import { orders, payments, users } from '../../drizzle/schema'

export class ReportsService {
  async getSummary() {
    const [orderCount, userCount, revenueResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(orders),
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db
        .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
        .from(payments)
        .where(sql`status = 'successful'`),
    ])

    return {
      totalOrders: orderCount[0]?.count ?? 0,
      totalUsers: userCount[0]?.count ?? 0,
      totalRevenue: revenueResult[0]?.total ?? '0',
    }
  }

  async getOrdersByStatus() {
    const result = await db
      .select({
        status: orders.statusV2,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .groupBy(orders.statusV2)

    return result
  }

  async getRevenueByPeriod(params: { from: Date; to: Date }) {
    const result = await db
      .select({
        date: sql<string>`date_trunc('day', paid_at)::date::text`,
        total: sql<string>`sum(amount)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(
        and(
          sql`status = 'successful'`,
          gte(payments.paidAt, params.from),
          lte(payments.paidAt, params.to),
        ),
      )
      .groupBy(sql`date_trunc('day', paid_at)`)
      .orderBy(sql`date_trunc('day', paid_at)`)

    return result
  }
}

export const reportsService = new ReportsService()
