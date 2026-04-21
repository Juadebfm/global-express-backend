import { sql, eq, isNull, and, gte, lt, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { orders, payments } from '../../drizzle/schema'
import { settingsFxRateService } from './settings-fx-rate.service'
import { ShipmentStatusV2, UserRole } from '../types/enums'

const OFFICIAL_FX_FALLBACK_NGN_PER_USD = 1500

const DELIVERY_COMPLETED_V2: ShipmentStatusV2[] = [
  ShipmentStatusV2.PICKED_UP_COMPLETED,
  ShipmentStatusV2.DELIVERED_TO_RECIPIENT,
]

// In-motion: departed through destination-side delivery leg.
const IN_MOTION_V2: ShipmentStatusV2[] = [
  ShipmentStatusV2.FLIGHT_DEPARTED,
  ShipmentStatusV2.FLIGHT_LANDED_LAGOS,
  ShipmentStatusV2.VESSEL_DEPARTED,
  ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT,
  ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS,
  ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
  ShipmentStatusV2.LOCAL_COURIER_ASSIGNED,
  ShipmentStatusV2.IN_TRANSIT_TO_DESTINATION_CITY,
  ShipmentStatusV2.OUT_FOR_DELIVERY_DESTINATION_CITY,
  ShipmentStatusV2.READY_FOR_PICKUP,
]

// Pre-transit: not yet departed.
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

const NON_TERMINAL_V2: ShipmentStatusV2[] = [...IN_MOTION_V2, ...PRE_TRANSIT_V2]

type FxRateSource = 'configured_or_live' | 'official_fallback'

function calcChange(
  current: number,
  previous: number,
): { value: number; direction: 'up' | 'down' } | null {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 1000) / 10
  return { value: Math.abs(pct), direction: pct >= 0 ? 'up' : 'down' }
}

function clampMonths(months: number): number {
  if (!Number.isFinite(months)) return 3
  return Math.max(1, Math.min(12, Math.trunc(months)))
}

function parseNumber(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function monthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

function periodKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

export class DashboardService {
  private async resolveFxRate(): Promise<{ rate: number; source: FxRateSource }> {
    try {
      const rate = await settingsFxRateService.getEffectiveRate()
      return { rate, source: 'configured_or_live' }
    } catch {
      return { rate: OFFICIAL_FX_FALLBACK_NGN_PER_USD, source: 'official_fallback' }
    }
  }

  async getStats(userId: string, role: string) {
    const isCustomer = role === UserRole.USER || role === UserRole.SUPPLIER
    const isSuperAdmin = role === UserRole.SUPER_ADMIN
    const needsFinancial = isCustomer || isSuperAdmin
    const userFilter = isCustomer ? eq(orders.senderId, userId) : undefined

    const now = new Date()
    const now30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const now60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    const now30s = now30.toISOString()
    const now60s = now60.toISOString()

    const inMotionPgArr = `{${IN_MOTION_V2.join(',')}}`
    const preTransitPgArr = `{${PRE_TRANSIT_V2.join(',')}}`
    const deliveredPgArr = `{${DELIVERY_COMPLETED_V2.join(',')}}`

    const countQuery = db
      .select({
        statusV2: orders.statusV2,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(isNull(orders.deletedAt), userFilter))
      .groupBy(orders.statusV2)

    const deliveredTodayQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          inArray(orders.statusV2, DELIVERY_COMPLETED_V2),
          gte(orders.updatedAt, dayStartUtc(now)),
          userFilter,
        ),
      )

    const changeQuery = db
      .select({
        currentOrders: sql<number>`count(*) filter (where ${orders.createdAt} >= ${now30s}::timestamptz)::int`,
        prevOrders: sql<number>`count(*) filter (where ${orders.createdAt} >= ${now60s}::timestamptz and ${orders.createdAt} < ${now30s}::timestamptz)::int`,
        currentShipments: sql<number>`count(*) filter (where (${orders.statusV2} is null or ${orders.statusV2} <> 'CANCELLED') and ${orders.createdAt} >= ${now30s}::timestamptz)::int`,
        prevShipments: sql<number>`count(*) filter (where (${orders.statusV2} is null or ${orders.statusV2} <> 'CANCELLED') and ${orders.createdAt} >= ${now60s}::timestamptz and ${orders.createdAt} < ${now30s}::timestamptz)::int`,
        currentActive: sql<number>`count(*) filter (where ${orders.statusV2} = ANY(${inMotionPgArr}::shipment_status_v2[]) and ${orders.createdAt} >= ${now30s}::timestamptz)::int`,
        prevActive: sql<number>`count(*) filter (where ${orders.statusV2} = ANY(${inMotionPgArr}::shipment_status_v2[]) and ${orders.createdAt} >= ${now60s}::timestamptz and ${orders.createdAt} < ${now30s}::timestamptz)::int`,
        currentPending: sql<number>`count(*) filter (where ${orders.statusV2} = ANY(${preTransitPgArr}::shipment_status_v2[]) and ${orders.createdAt} >= ${now30s}::timestamptz)::int`,
        prevPending: sql<number>`count(*) filter (where ${orders.statusV2} = ANY(${preTransitPgArr}::shipment_status_v2[]) and ${orders.createdAt} >= ${now60s}::timestamptz and ${orders.createdAt} < ${now30s}::timestamptz)::int`,
        currentDelivered: sql<number>`count(*) filter (where ${orders.statusV2} = ANY(${deliveredPgArr}::shipment_status_v2[]) and ${orders.updatedAt} >= ${now30s}::timestamptz)::int`,
        prevDelivered: sql<number>`count(*) filter (where ${orders.statusV2} = ANY(${deliveredPgArr}::shipment_status_v2[]) and ${orders.updatedAt} >= ${now60s}::timestamptz and ${orders.updatedAt} < ${now30s}::timestamptz)::int`,
        currentCancelled: sql<number>`count(*) filter (where ${orders.statusV2} = 'CANCELLED' and ${orders.updatedAt} >= ${now30s}::timestamptz)::int`,
        prevCancelled: sql<number>`count(*) filter (where ${orders.statusV2} = 'CANCELLED' and ${orders.updatedAt} >= ${now60s}::timestamptz and ${orders.updatedAt} < ${now30s}::timestamptz)::int`,
      })
      .from(orders)
      .where(and(isNull(orders.deletedAt), userFilter))

    const [{ rate: fxRateNgnPerUsd, source: fxRateSource }, statusRows, [deliveredToday], [changeRow]] =
      await Promise.all([
        needsFinancial
          ? this.resolveFxRate()
          : Promise.resolve({
              rate: OFFICIAL_FX_FALLBACK_NGN_PER_USD,
              source: 'official_fallback' as FxRateSource,
            }),
        countQuery,
        deliveredTodayQuery,
        changeQuery,
      ])

    const financialWhere = and(
      sql`${payments.status} = 'successful'`,
      isCustomer ? eq(payments.userId, userId) : undefined,
    )

    const financialQuery = needsFinancial
      ? db
          .select({
            totalUsd: sql<string>`coalesce(sum(case when upper(${payments.currency}) = 'USD' then ${payments.amount} else ${payments.amount} / ${fxRateNgnPerUsd} end), 0)::text`,
            totalNgn: sql<string>`coalesce(sum(case when upper(${payments.currency}) = 'USD' then ${payments.amount} * ${fxRateNgnPerUsd} else ${payments.amount} end), 0)::text`,
          })
          .from(payments)
          .where(financialWhere)
      : null

    const finChangeQuery = needsFinancial
      ? db
          .select({
            currentUsd: sql<string>`coalesce(sum(case when upper(${payments.currency}) = 'USD' then ${payments.amount} else ${payments.amount} / ${fxRateNgnPerUsd} end) filter (where ${payments.createdAt} >= ${now30s}::timestamptz), 0)::text`,
            prevUsd: sql<string>`coalesce(sum(case when upper(${payments.currency}) = 'USD' then ${payments.amount} else ${payments.amount} / ${fxRateNgnPerUsd} end) filter (where ${payments.createdAt} >= ${now60s}::timestamptz and ${payments.createdAt} < ${now30s}::timestamptz), 0)::text`,
            currentNgn: sql<string>`coalesce(sum(case when upper(${payments.currency}) = 'USD' then ${payments.amount} * ${fxRateNgnPerUsd} else ${payments.amount} end) filter (where ${payments.createdAt} >= ${now30s}::timestamptz), 0)::text`,
            prevNgn: sql<string>`coalesce(sum(case when upper(${payments.currency}) = 'USD' then ${payments.amount} * ${fxRateNgnPerUsd} else ${payments.amount} end) filter (where ${payments.createdAt} >= ${now60s}::timestamptz and ${payments.createdAt} < ${now30s}::timestamptz), 0)::text`,
          })
          .from(payments)
          .where(financialWhere)
      : null

    const [financialRow, finChangeRow] = await Promise.all([
      financialQuery ? financialQuery : Promise.resolve([]),
      finChangeQuery ? finChangeQuery : Promise.resolve([]),
    ])

    const [financial] = financialRow as [{ totalUsd: string; totalNgn: string }?]
    const [finChange] = finChangeRow as [{ currentUsd: string; prevUsd: string; currentNgn: string; prevNgn: string }?]

    const countByStatus: Record<string, number> = {}
    let unmappedOrders = 0

    for (const row of statusRows) {
      if (row.statusV2 === null) {
        unmappedOrders += row.count
      } else {
        countByStatus[row.statusV2] = row.count
      }
    }

    const totalOrders = statusRows.reduce((sum, row) => sum + row.count, 0)
    const cancelledShipmentsCount = countByStatus[ShipmentStatusV2.CANCELLED] ?? 0
    const totalShipments = totalOrders - cancelledShipmentsCount
    const activeShipments = IN_MOTION_V2.reduce((sum, status) => sum + (countByStatus[status] ?? 0), 0)
    const pendingOrders = PRE_TRANSIT_V2.reduce((sum, status) => sum + (countByStatus[status] ?? 0), 0)
    const deliveryCompletedCount = DELIVERY_COMPLETED_V2.reduce(
      (sum, status) => sum + (countByStatus[status] ?? 0),
      0,
    )

    const currentUsd = parseNumber(finChange?.currentUsd)
    const prevUsd = parseNumber(finChange?.prevUsd)
    const currentNgn = parseNumber(finChange?.currentNgn)
    const prevNgn = parseNumber(finChange?.prevNgn)

    return {
      totalOrders,
      totalOrdersChange: calcChange(changeRow?.currentOrders ?? 0, changeRow?.prevOrders ?? 0),
      totalShipments,
      totalShipmentsChange: calcChange(
        changeRow?.currentShipments ?? 0,
        changeRow?.prevShipments ?? 0,
      ),
      activeShipments,
      activeShipmentsChange: calcChange(changeRow?.currentActive ?? 0, changeRow?.prevActive ?? 0),
      pendingOrders,
      pendingOrdersChange: calcChange(changeRow?.currentPending ?? 0, changeRow?.prevPending ?? 0),
      deliveredToday: deliveredToday?.count ?? 0,
      deliveryCompletedCount,
      deliveryCompletedCountChange: calcChange(
        changeRow?.currentDelivered ?? 0,
        changeRow?.prevDelivered ?? 0,
      ),
      // Backward-compatible aliases
      deliveredTotal: deliveryCompletedCount,
      deliveredTotalChange: calcChange(
        changeRow?.currentDelivered ?? 0,
        changeRow?.prevDelivered ?? 0,
      ),
      cancelled: cancelledShipmentsCount,
      cancelledShipmentsCount,
      cancelledShipmentsCountChange: calcChange(
        changeRow?.currentCancelled ?? 0,
        changeRow?.prevCancelled ?? 0,
      ),
      unmappedOrders,
      ...(isCustomer
        ? {
            totalSpent: financial?.totalUsd ?? '0',
            totalSpentUsd: financial?.totalUsd ?? '0',
            totalSpentNgn: financial?.totalNgn ?? '0',
            totalSpentChange: calcChange(currentUsd, prevUsd),
            totalSpentUsdChange: calcChange(currentUsd, prevUsd),
            totalSpentNgnChange: calcChange(currentNgn, prevNgn),
            fxRateNgnPerUsd: fxRateNgnPerUsd.toFixed(4),
            fxRateSource,
          }
        : isSuperAdmin
          ? {
              revenueMtd: financial?.totalNgn ?? '0',
              revenueMtdChange: calcChange(currentNgn, prevNgn),
              revenueUsd: financial?.totalUsd ?? '0',
              revenueNgn: financial?.totalNgn ?? '0',
              revenueUsdChange: calcChange(currentUsd, prevUsd),
              revenueNgnChange: calcChange(currentNgn, prevNgn),
              fxRateNgnPerUsd: fxRateNgnPerUsd.toFixed(4),
              fxRateSource,
            }
          : {}),
    }
  }

  /**
   * Shipment frequency trend over a rolling month window.
   * Default window is last 3 months (including current month).
   */
  async getTrends(userId: string, role: string, months: number) {
    const isCustomer = role === UserRole.USER || role === UserRole.SUPPLIER
    const rangeMonths = clampMonths(months)

    const now = new Date()
    const currentMonthStart = monthStartUtc(now)
    const rangeStart = addUtcMonths(currentMonthStart, -(rangeMonths - 1))
    const rangeEnd = addUtcMonths(currentMonthStart, 1)
    const deliveredPgArr = `{${DELIVERY_COMPLETED_V2.join(',')}}`
    const nonTerminalPgArr = `{${NON_TERMINAL_V2.join(',')}}`

    const rows = await db
      .select({
        period: sql<string>`to_char(date_trunc('month', ${orders.createdAt}), 'YYYY-MM')`,
        year: sql<number>`extract(year from ${orders.createdAt})::int`,
        month: sql<number>`extract(month from ${orders.createdAt})::int`,
        totalShipmentCount: sql<number>`count(*) filter (where (${orders.statusV2} is null or ${orders.statusV2} <> 'CANCELLED') )::int`,
        cancelledShipmentCount: sql<number>`count(*) filter (where ${orders.statusV2} = 'CANCELLED')::int`,
        deliveryCompletedCount: sql<number>`count(*) filter (where ${orders.statusV2} = ANY(${deliveredPgArr}::shipment_status_v2[]))::int`,
        deliveredWeight: sql<string>`coalesce(sum(${orders.weight}) filter (where ${orders.statusV2} = ANY(${deliveredPgArr}::shipment_status_v2[])), 0)::text`,
        activeWeight: sql<string>`coalesce(sum(${orders.weight}) filter (where ${orders.statusV2} = ANY(${nonTerminalPgArr}::shipment_status_v2[])), 0)::text`,
        totalWeight: sql<string>`coalesce(sum(${orders.weight}) filter (where (${orders.statusV2} is null or ${orders.statusV2} <> 'CANCELLED')), 0)::text`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          gte(orders.createdAt, rangeStart),
          lt(orders.createdAt, rangeEnd),
          isCustomer ? eq(orders.senderId, userId) : undefined,
        ),
      )
      .groupBy(sql`date_trunc('month', ${orders.createdAt})`)
      .orderBy(sql`date_trunc('month', ${orders.createdAt}) asc`)

    const byPeriod = new Map(rows.map((row) => [row.period, row]))
    const result: Array<{
      period: string
      year: number
      month: number
      totalShipmentCount: number
      cancelledShipmentCount: number
      deliveryCompletedCount: number
      deliveredWeight: string
      activeWeight: string
      totalWeight: string
    }> = []

    for (let i = 0; i < rangeMonths; i += 1) {
      const bucketDate = addUtcMonths(rangeStart, i)
      const key = periodKey(bucketDate)
      const row = byPeriod.get(key)

      result.push({
        period: key,
        year: bucketDate.getUTCFullYear(),
        month: bucketDate.getUTCMonth() + 1,
        totalShipmentCount: row?.totalShipmentCount ?? 0,
        cancelledShipmentCount: row?.cancelledShipmentCount ?? 0,
        deliveryCompletedCount: row?.deliveryCompletedCount ?? 0,
        deliveredWeight: row?.deliveredWeight ?? '0',
        activeWeight: row?.activeWeight ?? '0',
        totalWeight: row?.totalWeight ?? '0',
      })
    }

    return result
  }

  async getActiveDeliveries(userId: string, role: string) {
    const isCustomer = role === UserRole.USER || role === UserRole.SUPPLIER
    const now = new Date()
    const nonTerminalPgArr = `{${NON_TERMINAL_V2.join(',')}}`

    const rows = await db
      .select({
        destination: orders.destination,
        shipmentType: orders.shipmentType,
        count: sql<number>`count(*)::int`,
        nextEta: sql<string | null>`min(${orders.eta})::text`,
        minEta: sql<Date | null>`min(${orders.eta})`,
      })
      .from(orders)
      .where(
        and(
          isNull(orders.deletedAt),
          sql`${orders.statusV2} = ANY(${nonTerminalPgArr}::shipment_status_v2[])`,
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
