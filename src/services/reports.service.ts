import { sql, gte, lte, and, eq, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { orders, payments, users } from '../../drizzle/schema'
import { ShipmentStatusV2 } from '../types/enums'
import { decrypt } from '../utils/encryption'

// ─── Status metadata for pipeline endpoint ──────────────────────────────────

type Phase = 'pre_transit' | 'air_transit' | 'sea_transit' | 'lagos_processing' | 'terminal'

const STATUS_METADATA: Record<string, { label: string; phase: Phase }> = {
  PREORDER_SUBMITTED: { label: 'Preorder Submitted', phase: 'pre_transit' },
  AWAITING_WAREHOUSE_RECEIPT: { label: 'Awaiting Warehouse', phase: 'pre_transit' },
  WAREHOUSE_RECEIVED: { label: 'Warehouse Received', phase: 'pre_transit' },
  WAREHOUSE_VERIFIED_PRICED: { label: 'Verified & Priced', phase: 'pre_transit' },
  DISPATCHED_TO_ORIGIN_AIRPORT: { label: 'To Origin Airport', phase: 'air_transit' },
  AT_ORIGIN_AIRPORT: { label: 'At Origin Airport', phase: 'air_transit' },
  BOARDED_ON_FLIGHT: { label: 'Boarded on Flight', phase: 'air_transit' },
  FLIGHT_DEPARTED: { label: 'Flight Departed', phase: 'air_transit' },
  FLIGHT_LANDED_LAGOS: { label: 'Landed in Lagos', phase: 'air_transit' },
  DISPATCHED_TO_ORIGIN_PORT: { label: 'To Origin Port', phase: 'sea_transit' },
  AT_ORIGIN_PORT: { label: 'At Origin Port', phase: 'sea_transit' },
  LOADED_ON_VESSEL: { label: 'Loaded on Vessel', phase: 'sea_transit' },
  VESSEL_DEPARTED: { label: 'Vessel Departed', phase: 'sea_transit' },
  VESSEL_ARRIVED_LAGOS_PORT: { label: 'Arrived Lagos Port', phase: 'sea_transit' },
  CUSTOMS_CLEARED_LAGOS: { label: 'Customs Cleared', phase: 'lagos_processing' },
  IN_TRANSIT_TO_LAGOS_OFFICE: { label: 'To Lagos Office', phase: 'lagos_processing' },
  READY_FOR_PICKUP: { label: 'Ready for Pickup', phase: 'lagos_processing' },
  PICKED_UP_COMPLETED: { label: 'Picked Up', phase: 'terminal' },
  ON_HOLD: { label: 'On Hold', phase: 'pre_transit' },
  CANCELLED: { label: 'Cancelled', phase: 'terminal' },
  RESTRICTED_ITEM_REJECTED: { label: 'Restricted Rejected', phase: 'terminal' },
  RESTRICTED_ITEM_OVERRIDE_APPROVED: { label: 'Override Approved', phase: 'pre_transit' },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcChange(
  current: number,
  previous: number,
): { value: number; direction: 'up' | 'down' } | null {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 1000) / 10
  return { value: Math.abs(pct), direction: pct >= 0 ? 'up' : 'down' }
}

/** Return a safe date_trunc SQL fragment. groupBy is Zod-validated enum, column is a literal. */
function truncExpr(groupBy: 'day' | 'week' | 'month', column: 'paid_at' | 'created_at') {
  // Both groupBy and column are compile-time restricted to known literal values.
  // Using sql.raw here is safe because neither can contain user input.
  const intervals = { day: 'day', week: 'week', month: 'month' } as const
  const columns = { paid_at: 'paid_at', created_at: 'created_at' } as const
  return sql.raw(`date_trunc('${intervals[groupBy]}', ${columns[column]})`)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ReportsService {
  // ── Existing: kept for backward compat ──────────────────────────────────

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

  // ── 1. Revenue Analytics (enhanced) ─────────────────────────────────────

  async getRevenueAnalytics(params: {
    from: Date
    to: Date
    groupBy: 'day' | 'week' | 'month'
    compareToLastPeriod: boolean
  }) {
    const trunc = truncExpr(params.groupBy, 'paid_at')

    const periodsQuery = db
      .select({
        period: sql<string>`${trunc}::date::text`,
        revenue: sql<string>`coalesce(sum(amount), 0)::text`,
        paymentCount: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(
        and(
          sql`status = 'successful'`,
          gte(payments.paidAt, params.from),
          lte(payments.paidAt, params.to),
        ),
      )
      .groupBy(trunc)
      .orderBy(trunc)

    const totalsQuery = db
      .select({
        totalRevenue: sql<string>`coalesce(sum(amount), 0)::text`,
        totalPayments: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(
        and(
          sql`status = 'successful'`,
          gte(payments.paidAt, params.from),
          lte(payments.paidAt, params.to),
        ),
      )

    // Comparison: same-length window before `from`
    const rangeMs = params.to.getTime() - params.from.getTime()
    const prevFrom = new Date(params.from.getTime() - rangeMs)

    const comparisonQuery = params.compareToLastPeriod
      ? db
          .select({
            previousRevenue: sql<string>`coalesce(sum(amount), 0)::text`,
            previousPayments: sql<number>`count(*)::int`,
          })
          .from(payments)
          .where(
            and(
              sql`status = 'successful'`,
              gte(payments.paidAt, prevFrom),
              lte(payments.paidAt, params.from),
            ),
          )
      : null

    const [periods, [totals], compResult] = await Promise.all([
      periodsQuery,
      totalsQuery,
      comparisonQuery ?? Promise.resolve(null),
    ])

    const totalRev = parseFloat(totals?.totalRevenue ?? '0')
    const totalPay = totals?.totalPayments ?? 0
    const avgOrderValue = totalPay > 0 ? (totalRev / totalPay).toFixed(2) : '0'

    const result: Record<string, unknown> = {
      periods: periods.map((p) => ({
        ...p,
        avgOrderValue:
          p.paymentCount > 0
            ? (parseFloat(p.revenue) / p.paymentCount).toFixed(2)
            : '0',
      })),
      totals: {
        totalRevenue: totals?.totalRevenue ?? '0',
        totalPayments: totalPay,
        avgOrderValue,
      },
    }

    if (params.compareToLastPeriod && compResult) {
      const comp = Array.isArray(compResult) ? compResult[0] : compResult
      result.comparison = {
        previousRevenue: comp?.previousRevenue ?? '0',
        previousPayments: comp?.previousPayments ?? 0,
        revenueChange: calcChange(totalRev, parseFloat(comp?.previousRevenue ?? '0')),
      }
    }

    return result
  }

  // ── 2. Shipment Volume ──────────────────────────────────────────────────

  async getShipmentVolume(params: {
    from: Date
    to: Date
    groupBy: 'day' | 'week' | 'month'
  }) {
    const trunc = truncExpr(params.groupBy, 'created_at')

    const periodsQuery = db
      .select({
        period: sql<string>`${trunc}::date::text`,
        total: sql<number>`count(*)::int`,
        air: sql<number>`count(*) filter (where transport_mode = 'air')::int`,
        sea: sql<number>`count(*) filter (where transport_mode = 'sea')::int`,
        totalWeight: sql<string>`coalesce(sum(weight), 0)::text`,
        airWeight: sql<string>`coalesce(sum(weight) filter (where transport_mode = 'air'), 0)::text`,
        seaWeight: sql<string>`coalesce(sum(weight) filter (where transport_mode = 'sea'), 0)::text`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          gte(orders.createdAt, params.from),
          lte(orders.createdAt, params.to),
        ),
      )
      .groupBy(trunc)
      .orderBy(trunc)

    const totalsQuery = db
      .select({
        totalShipments: sql<number>`count(*)::int`,
        airShipments: sql<number>`count(*) filter (where transport_mode = 'air')::int`,
        seaShipments: sql<number>`count(*) filter (where transport_mode = 'sea')::int`,
        totalWeight: sql<string>`coalesce(sum(weight), 0)::text`,
        airWeight: sql<string>`coalesce(sum(weight) filter (where transport_mode = 'air'), 0)::text`,
        seaWeight: sql<string>`coalesce(sum(weight) filter (where transport_mode = 'sea'), 0)::text`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          gte(orders.createdAt, params.from),
          lte(orders.createdAt, params.to),
        ),
      )

    const [periods, [totals]] = await Promise.all([periodsQuery, totalsQuery])

    return {
      periods,
      totals: totals ?? {
        totalShipments: 0,
        airShipments: 0,
        seaShipments: 0,
        totalWeight: '0',
        airWeight: '0',
        seaWeight: '0',
      },
    }
  }

  // ── 3. Top Customers ────────────────────────────────────────────────────

  async getTopCustomers(params: {
    from: Date
    to: Date
    sortBy: 'orderCount' | 'totalWeight' | 'revenue'
    limit: number
    isSuperAdmin: boolean
  }) {
    const sortMap = {
      orderCount: sql`count(o.id) desc`,
      totalWeight: sql`coalesce(sum(o.weight), 0) desc`,
      revenue: sql`coalesce(sum(p.amount) filter (where p.status = 'successful'), 0) desc`,
    }

    const fromStr = params.from.toISOString()
    const toStr = params.to.toISOString()

    const rows = await db.execute(sql`
      select
        u.id as customer_id,
        u.email,
        u.first_name,
        u.last_name,
        u.business_name,
        count(distinct o.id)::int as order_count,
        coalesce(sum(o.weight), 0)::text as total_weight,
        case when count(distinct o.id) > 0
          then round((sum(o.weight) / count(distinct o.id))::numeric, 2)::text
          else '0'
        end as avg_weight,
        coalesce(sum(p.amount) filter (where p.status = 'successful'), 0)::text as revenue
      from users u
        join orders o on o.sender_id = u.id and o.deleted_at is null
          and o.created_at >= ${fromStr}::timestamptz and o.created_at <= ${toStr}::timestamptz
        left join payments p on p.order_id = o.id
      where u.role = 'user' and u.deleted_at is null
      group by u.id
      order by ${sortMap[params.sortBy]}
      limit ${params.limit}
    `)

    return (rows as unknown as Array<Record<string, unknown>>).map((row) => {
      const firstName = row.first_name ? decrypt(row.first_name as string) : null
      const lastName = row.last_name ? decrypt(row.last_name as string) : null
      const businessName = row.business_name ? decrypt(row.business_name as string) : null
      const displayName = businessName || [firstName, lastName].filter(Boolean).join(' ') || null

      const result: Record<string, unknown> = {
        customerId: row.customer_id,
        displayName,
        email: row.email ? decrypt(row.email as string) : null,
        orderCount: row.order_count,
        totalWeight: row.total_weight,
        avgWeight: row.avg_weight,
      }

      if (params.isSuperAdmin) {
        result.revenue = row.revenue
      }

      return result
    })
  }

  // ── 4. Delivery Performance ─────────────────────────────────────────────

  async getDeliveryPerformance(params: { from: Date; to: Date }) {
    const fromStr = params.from.toISOString()
    const toStr = params.to.toISOString()

    const baseWhere = sql`
      o.deleted_at is null
      and o.status_v2 = 'PICKED_UP_COMPLETED'
      and e.status = 'PICKED_UP_COMPLETED'
      and e.created_at >= ${fromStr}::timestamptz and e.created_at <= ${toStr}::timestamptz
    `

    const overallQuery = db.execute(sql`
      select
        round(avg(extract(epoch from (e.created_at - o.created_at)) / 86400.0)::numeric, 1)::text as avg_days,
        round((percentile_cont(0.5) within group (order by extract(epoch from (e.created_at - o.created_at)) / 86400.0))::numeric, 1)::text as median_days,
        count(*)::int as total_delivered
      from orders o
        join order_status_events e on e.order_id = o.id
      where ${baseWhere}
    `)

    const byModeQuery = db.execute(sql`
      select
        o.transport_mode,
        round(avg(extract(epoch from (e.created_at - o.created_at)) / 86400.0)::numeric, 1)::text as avg_days,
        round((percentile_cont(0.5) within group (order by extract(epoch from (e.created_at - o.created_at)) / 86400.0))::numeric, 1)::text as median_days,
        count(*)::int as total_delivered,
        round(min(extract(epoch from (e.created_at - o.created_at)) / 86400.0)::numeric, 1)::text as min_days,
        round(max(extract(epoch from (e.created_at - o.created_at)) / 86400.0)::numeric, 1)::text as max_days
      from orders o
        join order_status_events e on e.order_id = o.id
      where ${baseWhere}
        and o.transport_mode is not null
      group by o.transport_mode
    `)

    const byMonthQuery = db.execute(sql`
      select
        date_trunc('month', e.created_at)::date::text as period,
        round(avg(extract(epoch from (e.created_at - o.created_at)) / 86400.0)::numeric, 1)::text as avg_days,
        count(*)::int as total_delivered
      from orders o
        join order_status_events e on e.order_id = o.id
      where ${baseWhere}
      group by date_trunc('month', e.created_at)
      order by date_trunc('month', e.created_at)
    `)

    const [overallResult, byModeResult, byMonthResult] = await Promise.all([
      overallQuery,
      byModeQuery,
      byMonthQuery,
    ])

    const overall = (overallResult as unknown as Array<Record<string, unknown>>)[0]
    const byMode = byModeResult as unknown as Array<Record<string, unknown>>
    const byMonth = byMonthResult as unknown as Array<Record<string, unknown>>

    return {
      overall: {
        avgDaysToDeliver: (overall?.avg_days as string) ?? null,
        medianDaysToDeliver: (overall?.median_days as string) ?? null,
        totalDelivered: (overall?.total_delivered as number) ?? 0,
      },
      byTransportMode: byMode.map((r) => ({
        transportMode: r.transport_mode as string,
        avgDaysToDeliver: (r.avg_days as string) ?? null,
        medianDaysToDeliver: (r.median_days as string) ?? null,
        totalDelivered: (r.total_delivered as number) ?? 0,
        minDays: (r.min_days as string) ?? null,
        maxDays: (r.max_days as string) ?? null,
      })),
      byMonth: byMonth.map((r) => ({
        period: r.period as string,
        avgDaysToDeliver: (r.avg_days as string) ?? null,
        totalDelivered: (r.total_delivered as number) ?? 0,
      })),
    }
  }

  // ── 5. Status Pipeline ──────────────────────────────────────────────────

  async getStatusPipeline(params: { transportMode?: 'air' | 'sea' }) {
    const rows = await db
      .select({
        status: orders.statusV2,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          params.transportMode ? eq(orders.transportMode, params.transportMode) : undefined,
        ),
      )
      .groupBy(orders.statusV2)

    const totalAll = rows.reduce((sum, r) => sum + r.count, 0)
    const terminalStatuses: string[] = [
      ShipmentStatusV2.PICKED_UP_COMPLETED,
      ShipmentStatusV2.CANCELLED,
      ShipmentStatusV2.RESTRICTED_ITEM_REJECTED,
    ]
    const totalActive = rows
      .filter((r) => r.status && !terminalStatuses.includes(r.status))
      .reduce((sum, r) => sum + r.count, 0)

    const pipeline = rows.map((r) => {
      const key = r.status ?? 'UNKNOWN'
      const meta = STATUS_METADATA[key] ?? { label: 'Unknown', phase: 'pre_transit' as Phase }
      return {
        status: key,
        label: meta.label,
        count: r.count,
        percentage: totalAll > 0 ? ((r.count / totalAll) * 100).toFixed(1) : '0',
        phase: meta.phase,
      }
    })

    return { pipeline, totalActive, totalAll }
  }

  // ── 6. Payment Breakdown ────────────────────────────────────────────────

  async getPaymentBreakdown(params: { from: Date; to: Date }) {
    const fromStr = params.from.toISOString()
    const toStr = params.to.toISOString()

    const byTypeQuery = db.execute(sql`
      select
        payment_type,
        count(*)::int as total,
        count(*) filter (where status = 'successful')::int as successful,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'pending')::int as pending,
        count(*) filter (where status = 'abandoned')::int as abandoned,
        coalesce(sum(amount) filter (where status = 'successful'), 0)::text as total_amount
      from payments
      where created_at >= ${fromStr}::timestamptz and created_at <= ${toStr}::timestamptz
      group by payment_type
    `)

    const byStatusQuery = db.execute(sql`
      select
        status,
        count(*)::int as count,
        coalesce(sum(amount), 0)::text as amount
      from payments
      where created_at >= ${fromStr}::timestamptz and created_at <= ${toStr}::timestamptz
      group by status
    `)

    const collectionQuery = db.execute(sql`
      select
        payment_collection_status as status,
        count(*)::int as order_count,
        coalesce(sum(final_charge_usd), 0)::text as total_charge
      from orders
      where deleted_at is null
        and created_at >= ${fromStr}::timestamptz and created_at <= ${toStr}::timestamptz
      group by payment_collection_status
    `)

    const [byTypeResult, byStatusResult, collectionResult] = await Promise.all([
      byTypeQuery,
      byStatusQuery,
      collectionQuery,
    ])

    const byType = byTypeResult as unknown as Array<Record<string, unknown>>
    const byStatus = byStatusResult as unknown as Array<Record<string, unknown>>
    const collection = collectionResult as unknown as Array<Record<string, unknown>>

    return {
      byType: byType.map((r) => ({
        paymentType: r.payment_type as string,
        total: r.total as number,
        successful: r.successful as number,
        failed: r.failed as number,
        pending: r.pending as number,
        abandoned: r.abandoned as number,
        successRate:
          (r.total as number) > 0
            ? (((r.successful as number) / (r.total as number)) * 100).toFixed(1)
            : '0',
        totalAmount: r.total_amount as string,
      })),
      byStatus: byStatus.map((r) => ({
        status: r.status as string,
        count: r.count as number,
        amount: r.amount as string,
      })),
      collectionStatus: collection.map((r) => ({
        status: r.status as string,
        orderCount: r.order_count as number,
        totalCharge: r.total_charge as string,
      })),
    }
  }

  // ── 7. Shipment Comparison (air vs sea) ─────────────────────────────────

  async getShipmentComparison(params: {
    from: Date
    to: Date
    isSuperAdmin: boolean
  }) {
    const fromStr = params.from.toISOString()
    const toStr = params.to.toISOString()

    const mainQuery = db.execute(sql`
      select
        o.transport_mode,
        count(distinct o.id)::int as order_count,
        coalesce(sum(o.weight), 0)::text as total_weight,
        case when count(distinct o.id) > 0
          then round((sum(o.weight) / count(distinct o.id))::numeric, 2)::text
          else '0'
        end as avg_weight,
        coalesce(sum(p.amount) filter (where p.status = 'successful'), 0)::text as total_revenue,
        count(distinct o.id) filter (where o.status_v2 = 'PICKED_UP_COMPLETED')::int as completed_count,
        count(distinct o.id) filter (where o.status_v2 = 'CANCELLED')::int as cancelled_count
      from orders o
        left join payments p on p.order_id = o.id
      where o.deleted_at is null
        and o.transport_mode is not null
        and o.created_at >= ${fromStr}::timestamptz and o.created_at <= ${toStr}::timestamptz
      group by o.transport_mode
    `)

    const deliveryQuery = db.execute(sql`
      select
        o.transport_mode,
        round(avg(extract(epoch from (e.created_at - o.created_at)) / 86400.0)::numeric, 1)::text as avg_delivery_days
      from orders o
        join order_status_events e on e.order_id = o.id and e.status = 'PICKED_UP_COMPLETED'
      where o.deleted_at is null
        and o.transport_mode is not null
        and o.created_at >= ${fromStr}::timestamptz and o.created_at <= ${toStr}::timestamptz
      group by o.transport_mode
    `)

    const [mainResult, deliveryResult] = await Promise.all([mainQuery, deliveryQuery])

    const main = mainResult as unknown as Array<Record<string, unknown>>
    const delivery = deliveryResult as unknown as Array<Record<string, unknown>>

    const deliveryMap = new Map<string, string>()
    for (const r of delivery) {
      deliveryMap.set(r.transport_mode as string, r.avg_delivery_days as string)
    }

    return {
      comparison: main.map((r) => {
        const orderCount = r.order_count as number
        const completedCount = r.completed_count as number
        const result: Record<string, unknown> = {
          transportMode: r.transport_mode,
          orderCount,
          totalWeight: r.total_weight,
          avgWeight: r.avg_weight,
          completedCount,
          cancelledCount: r.cancelled_count,
          completionRate: orderCount > 0 ? ((completedCount / orderCount) * 100).toFixed(1) : '0',
          avgDeliveryDays: deliveryMap.get(r.transport_mode as string) ?? null,
        }

        if (params.isSuperAdmin) {
          result.totalRevenue = r.total_revenue
          const rev = parseFloat(r.total_revenue as string)
          result.avgRevenue = orderCount > 0 ? (rev / orderCount).toFixed(2) : '0'
        }

        return result
      }),
    }
  }
}

export const reportsService = new ReportsService()
