import { sql, eq, isNull, and, gte, lt } from 'drizzle-orm'
import { db } from '../config/db'
import { orders, payments } from '../../drizzle/schema'
import { ShipmentStatusV2, UserRole } from '../types/enums'

// In-motion: flight/vessel departed through ready-for-pickup
const IN_MOTION_V2: ShipmentStatusV2[] = [
  ShipmentStatusV2.FLIGHT_DEPARTED,
  ShipmentStatusV2.FLIGHT_LANDED_LAGOS,
  ShipmentStatusV2.VESSEL_DEPARTED,
  ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT,
  ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS,
  ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
  ShipmentStatusV2.READY_FOR_PICKUP,
]

// Pre-transit: not yet departed (includes on-hold / override-approved)
const PRE_TRANSIT_V2: ShipmentStatusV2[] = [
  ShipmentStatusV2.PREORDER_SUBMITTED,
  ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT,
  ShipmentStatusV2.WAREHOUSE_RECEIVED,
  ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
  ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT,
  ShipmentStatusV2.AT_ORIGIN_AIRPORT,
  ShipmentStatusV2.BOARDED_ON_FLIGHT,
  ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT,
  ShipmentStatusV2.AT_ORIGIN_PORT,
  ShipmentStatusV2.LOADED_ON_VESSEL,
  ShipmentStatusV2.ON_HOLD,
  ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED,
]

// All non-terminal statuses (used for active deliveries filter)
const NON_TERMINAL_V2: ShipmentStatusV2[] = [...IN_MOTION_V2, ...PRE_TRANSIT_V2]

/** Build a SQL IN-list string from an array of V2 status values. */
function toSqlList(statuses: string[]): string {
  return statuses.map((s) => `'${s}'`).join(',')
}

/**
 * Computes a period-over-period % change.
 * Returns null when previous === 0 (no baseline — FE hides the badge).
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
   * KPI stats — counts by V2 status + financial summary + period-over-period change.
   *
   * Admin/staff/superadmin: global data across all orders.
   * Customer (role=user):   filtered to their own orders + their own payments.
   *
   * Change fields compare last 30 days vs the prior 30 days (days 31–60).
   * Returns null when the prior period had 0 activity (no baseline to compare).
   */
  async getStats(userId: string, role: string) {
    const isCustomer  = role === UserRole.USER
    const isSuperAdmin = role === UserRole.SUPERADMIN
    // Only fetch financial data for roles that will use it
    const needsFinancial = isCustomer || isSuperAdmin

    const now = new Date()
    const now30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const now60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    // Raw sql templates need ISO strings — the postgres driver can't serialize Date objects in FILTER clauses
    const now30s = now30.toISOString()
    const now60s = now60.toISOString()

    const userFilter = isCustomer ? eq(orders.senderId, userId) : undefined

    // ── All-time V2 status counts ──────────────────────────────────────────────
    const countQuery = db
      .select({
        statusV2: orders.statusV2,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(isNull(orders.deletedAt), userFilter))
      .groupBy(orders.statusV2)

    // ── All-time financial total (customer: own spend; superadmin: platform revenue) ─
    const financialQuery = needsFinancial
      ? (isCustomer
          ? db
              .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
              .from(payments)
              .where(and(eq(payments.userId, userId), sql`status = 'successful'`))
          : db
              .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
              .from(payments)
              .where(sql`status = 'successful'`))
      : null

    // ── Delivered today (PICKED_UP_COMPLETED) ─────────────────────────────────
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const deliveredTodayQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          eq(orders.statusV2, ShipmentStatusV2.PICKED_UP_COMPLETED),
          gte(orders.updatedAt, todayStart),
          userFilter,
        ),
      )

    // ── Period-over-period count changes (single query, conditional aggregation) ─
    const inMotionSql = toSqlList(IN_MOTION_V2)
    const preTransitSql = toSqlList(PRE_TRANSIT_V2)

    const changeQuery = db
      .select({
        currentOrders:    sql<number>`count(*) filter (where created_at >= ${now30s}::timestamptz)::int`,
        prevOrders:       sql<number>`count(*) filter (where created_at >= ${now60s}::timestamptz and created_at < ${now30s}::timestamptz)::int`,
        currentActive:    sql<number>`count(*) filter (where status_v2 in (${sql.raw(inMotionSql)}) and created_at >= ${now30s}::timestamptz)::int`,
        prevActive:       sql<number>`count(*) filter (where status_v2 in (${sql.raw(inMotionSql)}) and created_at >= ${now60s}::timestamptz and created_at < ${now30s}::timestamptz)::int`,
        currentPending:   sql<number>`count(*) filter (where status_v2 in (${sql.raw(preTransitSql)}) and created_at >= ${now30s}::timestamptz)::int`,
        prevPending:      sql<number>`count(*) filter (where status_v2 in (${sql.raw(preTransitSql)}) and created_at >= ${now60s}::timestamptz and created_at < ${now30s}::timestamptz)::int`,
        currentDelivered: sql<number>`count(*) filter (where status_v2 = 'PICKED_UP_COMPLETED' and updated_at >= ${now30s}::timestamptz)::int`,
        prevDelivered:    sql<number>`count(*) filter (where status_v2 = 'PICKED_UP_COMPLETED' and updated_at >= ${now60s}::timestamptz and updated_at < ${now30s}::timestamptz)::int`,
      })
      .from(orders)
      .where(and(isNull(orders.deletedAt), userFilter))

    // ── Period-over-period financial change ────────────────────────────────────
    const finChangeQuery = needsFinancial
      ? (isCustomer
          ? db
              .select({
                current: sql<string>`coalesce(sum(amount) filter (where created_at >= ${now30s}::timestamptz), 0)::text`,
                prev:    sql<string>`coalesce(sum(amount) filter (where created_at >= ${now60s}::timestamptz and created_at < ${now30s}::timestamptz), 0)::text`,
              })
              .from(payments)
              .where(and(eq(payments.userId, userId), sql`status = 'successful'`))
          : db
              .select({
                current: sql<string>`coalesce(sum(amount) filter (where created_at >= ${now30s}::timestamptz), 0)::text`,
                prev:    sql<string>`coalesce(sum(amount) filter (where created_at >= ${now60s}::timestamptz and created_at < ${now30s}::timestamptz), 0)::text`,
              })
              .from(payments)
              .where(sql`status = 'successful'`))
      : null

    const [statusRows, financialRow, [deliveredToday], [changeRow], finChangeRow] =
      await Promise.all([
        countQuery,
        financialQuery ? financialQuery : Promise.resolve([]),
        deliveredTodayQuery,
        changeQuery,
        finChangeQuery ? finChangeQuery : Promise.resolve([]),
      ])
    const [financial] = financialRow as [{ total: string }?]
    const [finChange] = finChangeRow as [{ current: string; prev: string }?]

    // Map V2 status rows to named counts (null statusV2 = pre-backfill orders, counted separately)
    const countByStatus: Record<string, number> = {}
    let unmappedCount = 0
    for (const r of statusRows) {
      if (r.statusV2 === null) {
        unmappedCount += r.count
      } else {
        countByStatus[r.statusV2] = r.count
      }
    }

    const activeCount = IN_MOTION_V2.reduce((sum, s) => sum + (countByStatus[s] ?? 0), 0)
    const pendingCount = PRE_TRANSIT_V2.reduce((sum, s) => sum + (countByStatus[s] ?? 0), 0)

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
      deliveredTotal:        countByStatus[ShipmentStatusV2.PICKED_UP_COMPLETED] ?? 0,
      deliveredTotalChange:  calcChange(changeRow?.currentDelivered ?? 0, changeRow?.prevDelivered ?? 0),
      cancelled: countByStatus[ShipmentStatusV2.CANCELLED] ?? 0,
      // unmappedOrders: orders whose statusV2 is still null (not yet backfilled)
      unmappedOrders: unmappedCount,
      // superadmin sees revenueMtd; customer sees totalSpent; staff/admin see neither
      ...(isCustomer
        ? {
            totalSpent:       financial?.total ?? '0',
            totalSpentChange: calcChange(finCurrent, finPrev),
          }
        : isSuperAdmin
          ? {
              revenueMtd:       financial?.total ?? '0',
              revenueMtdChange: calcChange(finCurrent, finPrev),
            }
          : {}),
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
    const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`)

    const rows = await db
      .select({
        month: sql<number>`extract(month from created_at)::int`,
        statusV2: orders.statusV2,
        totalWeight: sql<string>`coalesce(sum(weight), 0)::text`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          gte(orders.createdAt, yearStart),
          lt(orders.createdAt, yearEnd),
          isCustomer ? eq(orders.senderId, userId) : undefined,
        ),
      )
      .groupBy(sql`extract(month from created_at)`, orders.statusV2)

    // Build 12-month array
    const result = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      deliveredWeight: '0',
      activeWeight: '0',
    }))

    for (const row of rows) {
      const idx = row.month - 1
      if (row.statusV2 === ShipmentStatusV2.PICKED_UP_COMPLETED) {
        result[idx].deliveredWeight = row.totalWeight
      } else if (row.statusV2 && (NON_TERMINAL_V2 as string[]).includes(row.statusV2)) {
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
    const nonTerminalSql = toSqlList(NON_TERMINAL_V2)

    const rows = await db
      .select({
        destination: orders.destination,
        shipmentType: orders.shipmentType,
        count: sql<number>`count(*)::int`,
        nextEta: sql<string | null>`min(eta)::text`,
        minEta: sql<Date | null>`min(eta)`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          sql`status_v2 = ANY(ARRAY[${sql.raw(nonTerminalSql)}]::shipment_status_v2[])`,
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
