import { sql, eq, isNull, and, gte } from 'drizzle-orm'
import { db } from '../config/db'
import { orders, payments } from '../../drizzle/schema'
import { OrderStatus, UserRole } from '../types/enums'

// Active statuses — orders that are still in motion (not terminal)
const ACTIVE_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.PICKED_UP,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
]

export class DashboardService {
  /**
   * KPI stats — counts by status + financial summary.
   *
   * Admin/staff/superadmin: global data across all orders.
   * Customer (role=user):   filtered to their own orders + their own payments.
   */
  async getStats(userId: string, role: string) {
    const isCustomer = role === UserRole.USER

    // Order counts by status
    const countQuery = db
      .select({
        status: orders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          isCustomer ? eq(orders.senderId, userId) : undefined,
        ),
      )
      .groupBy(orders.status)

    // Financial: admin sees global revenue, customer sees their own total spent
    const financialQuery = isCustomer
      ? db
          .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
          .from(payments)
          .where(and(eq(payments.userId, userId), sql`status = 'successful'`))
      : db
          .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
          .from(payments)
          .where(sql`status = 'successful'`)

    // Delivered today (admin: all orders; customer: their own)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const deliveredTodayQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          eq(orders.status, OrderStatus.DELIVERED),
          gte(orders.updatedAt, todayStart),
          isCustomer ? eq(orders.senderId, userId) : undefined,
        ),
      )

    const [statusRows, [financial], [deliveredToday]] = await Promise.all([
      countQuery,
      financialQuery,
      deliveredTodayQuery,
    ])

    // Map status rows to named counts
    const countByStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]))

    const activeCount =
      (countByStatus[OrderStatus.IN_TRANSIT] ?? 0) +
      (countByStatus[OrderStatus.OUT_FOR_DELIVERY] ?? 0)

    return {
      totalOrders: statusRows.reduce((sum, r) => sum + r.count, 0),
      activeShipments: activeCount,
      pendingOrders:
        (countByStatus[OrderStatus.PENDING] ?? 0) +
        (countByStatus[OrderStatus.PICKED_UP] ?? 0),
      deliveredToday: deliveredToday?.count ?? 0,
      deliveredTotal: countByStatus[OrderStatus.DELIVERED] ?? 0,
      cancelled: countByStatus[OrderStatus.CANCELLED] ?? 0,
      returned: countByStatus[OrderStatus.RETURNED] ?? 0,
      // admin/staff see revenueMtd; customer sees totalSpent (their own payments)
      ...(isCustomer
        ? { totalSpent: financial?.total ?? '0' }
        : { revenueMtd: financial?.total ?? '0' }),
    }
  }

  /**
   * Shipment trends — monthly weight totals split by delivered vs active.
   * Y=weight (kg), X=month (1–12 for the given year).
   *
   * Returns all 12 months, defaulting to "0" for months with no data.
   */
  async getTrends(userId: string, role: string, year: number) {
    const isCustomer = role === UserRole.USER
    const yearStart = new Date(`${year}-01-01T00:00:00Z`)
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`)

    const rows = await db
      .select({
        month: sql<number>`extract(month from created_at)::int`,
        status: orders.status,
        totalWeight: sql<string>`coalesce(sum(weight), 0)::text`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          gte(orders.createdAt, yearStart),
          sql`created_at < ${yearEnd}`,
          isCustomer ? eq(orders.senderId, userId) : undefined,
        ),
      )
      .groupBy(sql`extract(month from created_at)`, orders.status)

    // Build 12-month array
    const result = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      deliveredWeight: '0',
      activeWeight: '0',
    }))

    for (const row of rows) {
      const idx = row.month - 1
      if (row.status === OrderStatus.DELIVERED) {
        result[idx].deliveredWeight = row.totalWeight
      } else if (ACTIVE_STATUSES.includes(row.status as OrderStatus)) {
        // Sum active weight (multiple status rows per month)
        const prev = parseFloat(result[idx].activeWeight)
        result[idx].activeWeight = (prev + parseFloat(row.totalWeight)).toFixed(2)
      }
    }

    return result
  }

  /**
   * Active deliveries — current non-terminal orders grouped by destination.
   * Status: on_time (ETA >= now), delayed (ETA < now and not null), unknown (no ETA).
   *
   * Admin/staff: all orders. Customer: their own.
   */
  async getActiveDeliveries(userId: string, role: string) {
    const isCustomer = role === UserRole.USER
    const now = new Date()

    const rows = await db
      .select({
        destination: orders.destination,
        shipmentType: orders.shipmentType,
        count: sql<number>`count(*)::int`,
        // earliest ETA for each destination group
        nextEta: sql<string | null>`min(eta)::text`,
        minEta: sql<Date | null>`min(eta)`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          sql`status = ANY(ARRAY['pending','picked_up','in_transit','out_for_delivery']::order_status[])`,
          isCustomer ? eq(orders.senderId, userId) : undefined,
        ),
      )
      .groupBy(orders.destination, orders.shipmentType)
      .orderBy(sql`count(*) desc`)

    return rows.map((row) => {
      let status: 'on_time' | 'delayed' | 'unknown'
      if (!row.minEta) {
        status = 'unknown'
      } else if (new Date(row.minEta) < now) {
        status = 'delayed'
      } else {
        status = 'on_time'
      }

      return {
        destination: row.destination,
        shipmentType: row.shipmentType,
        activeCount: row.count,
        nextEta: row.nextEta ?? null,
        status,
      }
    })
  }
}

export const dashboardService = new DashboardService()
