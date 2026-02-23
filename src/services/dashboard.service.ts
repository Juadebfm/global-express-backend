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

/**
 * Computes a period-over-period % change.
 * Returns null when previous === 0 (no baseline — FE hides the badge).
 * value is always positive; direction indicates growth or decline.
 */
function calcChange(
  current: number,
  previous: number,
): { value: number; direction: 'up' | 'down' } | null {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 1000) / 10
  return { value: Math.abs(pct), direction: pct >= 0 ? 'up' : 'down' }
}

export class DashboardService {
  /**
   * KPI stats — counts by status + financial summary + period-over-period change.
   *
   * Admin/staff/superadmin: global data across all orders.
   * Customer (role=user):   filtered to their own orders + their own payments.
   *
   * Change fields compare last 30 days vs the prior 30 days (days 31–60).
   * Returns null when the prior period had 0 activity (no baseline to compare).
   */
  async getStats(userId: string, role: string) {
    const isCustomer = role === UserRole.USER

    const now = new Date()
    const now30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const now60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

    const userFilter = isCustomer ? eq(orders.senderId, userId) : undefined

    // ── All-time status counts ─────────────────────────────────────────────────
    const countQuery = db
      .select({
        status: orders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(isNull(orders.deletedAt), userFilter))
      .groupBy(orders.status)

    // ── All-time financial total ───────────────────────────────────────────────
    const financialQuery = isCustomer
      ? db
          .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
          .from(payments)
          .where(and(eq(payments.userId, userId), sql`status = 'successful'`))
      : db
          .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
          .from(payments)
          .where(sql`status = 'successful'`)

    // ── Delivered today ────────────────────────────────────────────────────────
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
          userFilter,
        ),
      )

    // ── Period-over-period count changes (single query, conditional aggregation) ─
    // current = last 30 days | prev = days 31–60 ago
    const changeQuery = db
      .select({
        currentOrders:    sql<number>`count(*) filter (where created_at >= ${now30})::int`,
        prevOrders:       sql<number>`count(*) filter (where created_at >= ${now60} and created_at < ${now30})::int`,
        currentActive:    sql<number>`count(*) filter (where status in ('in_transit', 'out_for_delivery') and created_at >= ${now30})::int`,
        prevActive:       sql<number>`count(*) filter (where status in ('in_transit', 'out_for_delivery') and created_at >= ${now60} and created_at < ${now30})::int`,
        currentPending:   sql<number>`count(*) filter (where status in ('pending', 'picked_up') and created_at >= ${now30})::int`,
        prevPending:      sql<number>`count(*) filter (where status in ('pending', 'picked_up') and created_at >= ${now60} and created_at < ${now30})::int`,
        currentDelivered: sql<number>`count(*) filter (where status = 'delivered' and updated_at >= ${now30})::int`,
        prevDelivered:    sql<number>`count(*) filter (where status = 'delivered' and updated_at >= ${now60} and updated_at < ${now30})::int`,
      })
      .from(orders)
      .where(and(isNull(orders.deletedAt), userFilter))

    // ── Period-over-period financial change ────────────────────────────────────
    const finChangeQuery = isCustomer
      ? db
          .select({
            current: sql<string>`coalesce(sum(amount) filter (where created_at >= ${now30}), 0)::text`,
            prev:    sql<string>`coalesce(sum(amount) filter (where created_at >= ${now60} and created_at < ${now30}), 0)::text`,
          })
          .from(payments)
          .where(and(eq(payments.userId, userId), sql`status = 'successful'`))
      : db
          .select({
            current: sql<string>`coalesce(sum(amount) filter (where created_at >= ${now30}), 0)::text`,
            prev:    sql<string>`coalesce(sum(amount) filter (where created_at >= ${now60} and created_at < ${now30}), 0)::text`,
          })
          .from(payments)
          .where(sql`status = 'successful'`)

    const [statusRows, [financial], [deliveredToday], [changeRow], [finChange]] =
      await Promise.all([countQuery, financialQuery, deliveredTodayQuery, changeQuery, finChangeQuery])

    // Map status rows to named counts
    const countByStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]))

    const activeCount =
      (countByStatus[OrderStatus.IN_TRANSIT] ?? 0) +
      (countByStatus[OrderStatus.OUT_FOR_DELIVERY] ?? 0)

    const pendingCount =
      (countByStatus[OrderStatus.PENDING] ?? 0) +
      (countByStatus[OrderStatus.PICKED_UP] ?? 0)

    const finCurrent = parseFloat(finChange?.current ?? '0')
    const finPrev    = parseFloat(finChange?.prev    ?? '0')

    return {
      totalOrders:          statusRows.reduce((sum, r) => sum + r.count, 0),
      totalOrdersChange:    calcChange(changeRow?.currentOrders ?? 0, changeRow?.prevOrders ?? 0),
      activeShipments:         activeCount,
      activeShipmentsChange:   calcChange(changeRow?.currentActive ?? 0, changeRow?.prevActive ?? 0),
      pendingOrders:         pendingCount,
      pendingOrdersChange:   calcChange(changeRow?.currentPending ?? 0, changeRow?.prevPending ?? 0),
      deliveredToday:        deliveredToday?.count ?? 0,
      deliveredTotal:         countByStatus[OrderStatus.DELIVERED] ?? 0,
      deliveredTotalChange:   calcChange(changeRow?.currentDelivered ?? 0, changeRow?.prevDelivered ?? 0),
      cancelled: countByStatus[OrderStatus.CANCELLED] ?? 0,
      returned:  countByStatus[OrderStatus.RETURNED]  ?? 0,
      // admin/staff see revenueMtd; customer sees totalSpent (their own payments)
      ...(isCustomer
        ? {
            totalSpent:       financial?.total ?? '0',
            totalSpentChange: calcChange(finCurrent, finPrev),
          }
        : {
            revenueMtd:       financial?.total ?? '0',
            revenueMtdChange: calcChange(finCurrent, finPrev),
          }),
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
