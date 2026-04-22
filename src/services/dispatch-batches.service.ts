import { randomBytes } from 'crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../config/db'
import {
  dispatchBatches,
  invoices,
  orderPackages,
  orders,
  payments,
  shipmentMeasurements,
  users,
} from '../../drizzle/schema'
import { decrypt, encrypt } from '../utils/encryption'
import { pricingV2Service, SEA_CBM_TO_KG_FACTOR } from './pricing-v2.service'
import {
  ShipmentPayer,
  ShipmentStatusV2,
  ShipmentType,
  TransportMode,
  UserRole,
} from '../types/enums'
import { settingsFxRateService } from './settings-fx-rate.service'
import { generateTrackingNumber } from '../utils/tracking'

const FINALIZABLE_INVOICE_STATUSES: Array<'draft' | 'finalized'> = ['draft', 'finalized']
const DEPARTED_STATUSES = new Set<ShipmentStatusV2>([
  ShipmentStatusV2.FLIGHT_DEPARTED,
  ShipmentStatusV2.VESSEL_DEPARTED,
])

export interface IntakeGoodsInput {
  customerId: string
  mode: TransportMode
  shipmentType?: ShipmentType
  shipmentPayer?: ShipmentPayer
  billingSupplierId?: string
  createdBy: string
  goods: Array<{
    supplierId: string
    description?: string
    itemType?: string
    quantity?: number
    lengthCm?: number
    widthCm?: number
    heightCm?: number
    weightKg?: number
    cbm?: number
    itemCostUsd?: number
    requiresExtraTruckMovement?: boolean
  }>
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function inferShipmentType(mode: TransportMode, requestedType?: ShipmentType): ShipmentType {
  if (requestedType === ShipmentType.D2D) return ShipmentType.D2D
  if (requestedType === ShipmentType.AIR) return ShipmentType.AIR
  if (requestedType === ShipmentType.OCEAN) return ShipmentType.OCEAN
  return mode === TransportMode.AIR ? ShipmentType.AIR : ShipmentType.OCEAN
}

function toNumericString(value: number | null | undefined, decimals = 2): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return value.toFixed(decimals)
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isDepartedStatus(status: ShipmentStatusV2): boolean {
  return DEPARTED_STATUSES.has(status)
}

function generateMasterTrackingNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const randomPart = randomBytes(4).toString('hex').toUpperCase()
  return `GEX-MASTER-${datePart}-${randomPart}`
}

function generateInvoiceNumber(orderId: string): string {
  const compactId = orderId.replace(/-/g, '').toUpperCase()
  return `INV-${compactId}`
}

function formatUserDisplayName(row: {
  firstName: string | null
  lastName: string | null
  businessName: string | null
}): string {
  const first = row.firstName ? decrypt(row.firstName) : null
  const last = row.lastName ? decrypt(row.lastName) : null
  const business = row.businessName ? decrypt(row.businessName) : null

  if (first && last) return `${first} ${last}`
  if (first) return first
  if (business) return business
  return 'Supplier'
}

export class DispatchBatchesService {
  async getOrCreateOpenBatch(mode: TransportMode, actorId: string) {
    const [existing] = await db
      .select()
      .from(dispatchBatches)
      .where(
        and(
          eq(dispatchBatches.transportMode, mode),
          eq(dispatchBatches.status, 'open'),
          isNull(dispatchBatches.deletedAt),
        ),
      )
      // "Current" batch = oldest open batch in this mode.
      .orderBy(dispatchBatches.createdAt)
      .limit(1)

    if (existing) return existing

    const [created] = await db
      .insert(dispatchBatches)
      .values({
        masterTrackingNumber: generateMasterTrackingNumber(),
        transportMode: mode,
        status: 'open',
        createdBy: actorId,
      })
      .returning()

    return created
  }

  async canActorManageShipmentBatches(actorId: string, actorRole: UserRole): Promise<boolean> {
    if (actorRole === UserRole.SUPER_ADMIN) return true
    if (actorRole !== UserRole.STAFF) return false

    const [actor] = await db
      .select({
        role: users.role,
        canManageShipmentBatches: users.canManageShipmentBatches,
      })
      .from(users)
      .where(and(eq(users.id, actorId), isNull(users.deletedAt)))
      .limit(1)

    return Boolean(actor && actor.role === UserRole.STAFF && actor.canManageShipmentBatches)
  }

  async getOrCreateFutureBatch(mode: TransportMode, actorId: string, currentBatchId: string) {
    const [existingFuture] = await db
      .select()
      .from(dispatchBatches)
      .where(
        and(
          eq(dispatchBatches.transportMode, mode),
          eq(dispatchBatches.status, 'open'),
          isNull(dispatchBatches.deletedAt),
          sql`${dispatchBatches.id} <> ${currentBatchId}`,
        ),
      )
      .orderBy(desc(dispatchBatches.createdAt))
      .limit(1)

    if (existingFuture) return existingFuture

    const [created] = await db
      .insert(dispatchBatches)
      .values({
        masterTrackingNumber: generateMasterTrackingNumber(),
        transportMode: mode,
        status: 'open',
        createdBy: actorId,
      })
      .returning()

    return created
  }

  async requestCutoff(batchId: string, actorId: string) {
    const [updated] = await db
      .update(dispatchBatches)
      .set({
        status: 'cutoff_pending_approval',
        cutoffRequestedBy: actorId,
        cutoffRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dispatchBatches.id, batchId),
          eq(dispatchBatches.status, 'open'),
          isNull(dispatchBatches.deletedAt),
        ),
      )
      .returning()

    return updated ?? null
  }

  async approveCutoff(batchId: string, actorId: string) {
    const [updated] = await db
      .update(dispatchBatches)
      .set({
        status: 'closed',
        cutoffApprovedBy: actorId,
        cutoffApprovedAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dispatchBatches.id, batchId),
          inArray(dispatchBatches.status, ['open', 'cutoff_pending_approval']),
          isNull(dispatchBatches.deletedAt),
        ),
      )
      .returning()

    return updated ?? null
  }

  async updateBatchCarrierInfo(params: {
    batchId: string
    updatedBy: string
    carrierName?: string | null
    airlineTrackingNumber?: string | null
    oceanTrackingNumber?: string | null
    d2dTrackingNumber?: string | null
    voyageOrFlightNumber?: string | null
    estimatedDepartureAt?: Date | null
    estimatedArrivalAt?: Date | null
    notes?: string | null
  }) {
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    const carrierName = normalizeOptionalText(params.carrierName)
    if (carrierName !== undefined) patch.carrierName = carrierName

    const airlineTrackingNumber = normalizeOptionalText(params.airlineTrackingNumber)
    if (airlineTrackingNumber !== undefined) patch.airlineTrackingNumber = airlineTrackingNumber

    const oceanTrackingNumber = normalizeOptionalText(params.oceanTrackingNumber)
    if (oceanTrackingNumber !== undefined) patch.oceanTrackingNumber = oceanTrackingNumber

    const d2dTrackingNumber = normalizeOptionalText(params.d2dTrackingNumber)
    if (d2dTrackingNumber !== undefined) patch.d2dTrackingNumber = d2dTrackingNumber

    const voyageOrFlightNumber = normalizeOptionalText(params.voyageOrFlightNumber)
    if (voyageOrFlightNumber !== undefined) patch.voyageOrFlightNumber = voyageOrFlightNumber

    if (params.estimatedDepartureAt !== undefined) {
      patch.estimatedDepartureAt = params.estimatedDepartureAt
    }
    if (params.estimatedArrivalAt !== undefined) {
      patch.estimatedArrivalAt = params.estimatedArrivalAt
    }

    const notes = normalizeOptionalText(params.notes)
    if (notes !== undefined) patch.notes = notes

    if (Object.keys(patch).length === 1) {
      throw new Error('Provide at least one field to update.')
    }

    const [updated] = await db
      .update(dispatchBatches)
      .set(patch)
      .where(and(eq(dispatchBatches.id, params.batchId), isNull(dispatchBatches.deletedAt)))
      .returning()

    if (!updated) return null
    return this.mapBatch(updated)
  }

  async ensureDraftInvoiceForOrder(params: {
    orderId: string
    actorId: string
    totalUsd?: number
    shipmentPayer?: ShipmentPayer
    billToUserId?: string | null
    billToSupplierId?: string | null
  }) {
    const [orderMeta] = await db
      .select({
        senderId: orders.senderId,
        shipmentPayer: orders.shipmentPayer,
        billingSupplierId: orders.billingSupplierId,
      })
      .from(orders)
      .where(eq(orders.id, params.orderId))
      .limit(1)

    const resolvedShipmentPayer = params.shipmentPayer ?? orderMeta?.shipmentPayer ?? ShipmentPayer.USER
    const resolvedBillToUserId =
      params.billToUserId !== undefined
        ? params.billToUserId
        : resolvedShipmentPayer === ShipmentPayer.USER
          ? (orderMeta?.senderId ?? null)
          : null
    const resolvedBillToSupplierId =
      params.billToSupplierId !== undefined
        ? params.billToSupplierId
        : resolvedShipmentPayer === ShipmentPayer.SUPPLIER
          ? (orderMeta?.billingSupplierId ?? null)
          : null

    const [existing] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.orderId, params.orderId))
      .limit(1)

    let fxRate = 1500
    try {
      fxRate = await settingsFxRateService.getEffectiveRate()
    } catch {
      fxRate = 1500
    }

    const totalUsd = round2(params.totalUsd ?? 0)
    const totalNgn = round2(totalUsd * fxRate)

    if (!existing) {
      const [created] = await db
        .insert(invoices)
        .values({
          orderId: params.orderId,
          invoiceNumber: generateInvoiceNumber(params.orderId),
          status: 'draft',
          shipmentPayer: resolvedShipmentPayer,
          billToUserId: resolvedBillToUserId,
          billToSupplierId: resolvedBillToSupplierId,
          totalUsd: totalUsd.toFixed(2),
          fxRateNgnPerUsd: fxRate.toFixed(4),
          totalNgn: totalNgn.toFixed(2),
          createdBy: params.actorId,
          updatedBy: params.actorId,
        })
        .returning()
      return created
    }

    if (existing.status === 'draft') {
      const [updated] = await db
        .update(invoices)
        .set({
          totalUsd: totalUsd.toFixed(2),
          fxRateNgnPerUsd: fxRate.toFixed(4),
          totalNgn: totalNgn.toFixed(2),
          shipmentPayer: resolvedShipmentPayer,
          billToUserId: resolvedBillToUserId,
          billToSupplierId: resolvedBillToSupplierId,
          updatedBy: params.actorId,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, existing.id))
        .returning()
      return updated
    }

    return existing
  }

  async finalizeInvoicesForBatch(params: { batchId: string; actorId: string }) {
    const batchOrderIds = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.dispatchBatchId, params.batchId), isNull(orders.deletedAt)))

    const ids = batchOrderIds.map((r) => r.id)
    if (ids.length === 0) return

    await db
      .update(invoices)
      .set({
        status: 'finalized',
        finalizedAt: new Date(),
        finalizedBy: params.actorId,
        updatedBy: params.actorId,
        updatedAt: new Date(),
      })
      .where(and(inArray(invoices.orderId, ids), inArray(invoices.status, FINALIZABLE_INVOICE_STATUSES)))
  }

  async markInvoicePaidByOrder(params: { orderId: string; actorId?: string; paidAt?: Date | null }) {
    const [existing] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.orderId, params.orderId))
      .limit(1)

    if (!existing) return null

    const [updated] = await db
      .update(invoices)
      .set({
        status: 'paid',
        paidAt: params.paidAt ?? new Date(),
        finalizedAt: existing.finalizedAt ?? new Date(),
        updatedBy: params.actorId ?? existing.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, existing.id))
      .returning()

    return updated ?? null
  }

  async intakeGoods(input: IntakeGoodsInput) {
    if (input.goods.length === 0) {
      throw new Error('At least one goods item is required.')
    }

    const shipmentPayer = input.shipmentPayer ?? ShipmentPayer.USER
    const shipmentType = inferShipmentType(input.mode, input.shipmentType)

    const uniqueSupplierIds = [...new Set(input.goods.map((g) => g.supplierId))]
    const supplierRows = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(inArray(users.id, uniqueSupplierIds), isNull(users.deletedAt)))

    const supplierRoleMap = new Map(supplierRows.map((s) => [s.id, s.role]))
    const hasInvalidSupplier = uniqueSupplierIds.some((id) => supplierRoleMap.get(id) !== UserRole.SUPPLIER)
    if (hasInvalidSupplier) {
      throw new Error('One or more supplier IDs are invalid or not SUPPLIER accounts.')
    }

    let billingSupplierId: string | null = null
    if (shipmentPayer === ShipmentPayer.SUPPLIER) {
      if (uniqueSupplierIds.length !== 1) {
        throw new Error('Supplier-payer shipment must contain goods from exactly one supplier.')
      }
      billingSupplierId = input.billingSupplierId ?? uniqueSupplierIds[0] ?? null
      if (!billingSupplierId) {
        throw new Error('billingSupplierId is required when shipmentPayer is SUPPLIER.')
      }
      if (!supplierRoleMap.has(billingSupplierId)) {
        throw new Error('billingSupplierId must be a valid SUPPLIER account.')
      }
      if (billingSupplierId !== uniqueSupplierIds[0]) {
        throw new Error('billingSupplierId must match the supplier on all shipment goods.')
      }
    }

    if (shipmentType === ShipmentType.D2D) {
      const invalidD2DMeasures = input.goods.some((item) => {
        const weight = item.weightKg ?? 0
        const hasDimensions = Boolean(item.lengthCm && item.widthCm && item.heightCm)
        const derivedCbm = hasDimensions
          ? ((item.lengthCm! * item.widthCm! * item.heightCm!) / 1_000_000)
          : (item.cbm ?? 0)
        return weight <= 0 || derivedCbm <= 0
      })
      if (invalidD2DMeasures) {
        throw new Error('D2D intake requires both positive weight and volume (cbm/dimensions) for each goods line.')
      }
    }

    const [customer] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        businessName: users.businessName,
        phone: users.phone,
      })
      .from(users)
      .where(and(eq(users.id, input.customerId), isNull(users.deletedAt)))
      .limit(1)

    if (!customer) {
      throw new Error('Customer not found.')
    }

    const batch = await this.getOrCreateOpenBatch(input.mode, input.createdBy)

    const [existingShipment] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.senderId, input.customerId),
          eq(orders.dispatchBatchId, batch.id),
          eq(orders.transportMode, input.mode),
          eq(orders.shipmentType, shipmentType),
          eq(orders.shipmentPayer, shipmentPayer),
          shipmentPayer === ShipmentPayer.SUPPLIER
            ? eq(orders.billingSupplierId, billingSupplierId as string)
            : isNull(orders.billingSupplierId),
          isNull(orders.deletedAt),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1)

    const phone = customer.phone ? decrypt(customer.phone) : '+2340000000000'
    const customerName = formatUserDisplayName({
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: customer.businessName,
    })

    const shipment =
      existingShipment ??
      (
        await db
          .insert(orders)
          .values({
            trackingNumber: `GEX-CUST-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`,
            senderId: input.customerId,
            recipientName: encrypt(customerName),
            recipientAddress: encrypt('58B Awoniyi Elemo Street, Ajao Estate, Lagos, Nigeria'),
            recipientPhone: encrypt(phone),
            recipientEmail: null,
            origin: 'South Korea',
            destination: 'Lagos, Nigeria',
            orderDirection: 'outbound',
            description: 'Aggregated customer shipment',
            shipmentType,
            shipmentPayer,
            billingSupplierId,
            transportMode: input.mode,
            statusV2: ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT,
            customerStatusV2: ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT,
            createdBy: input.createdBy,
            dispatchBatchId: batch.id,
            isPreorder: false,
          })
          .returning()
      )[0]

    const now = new Date()
    const goodsRows = input.goods.map((item) => ({
      orderId: shipment.id,
      supplierId: item.supplierId,
      description: item.description ?? null,
      itemType: item.itemType ?? null,
      quantity: item.quantity && item.quantity > 0 ? item.quantity : 1,
      lengthCm: toNumericString(item.lengthCm, 2),
      widthCm: toNumericString(item.widthCm, 2),
      heightCm: toNumericString(item.heightCm, 2),
      weightKg: toNumericString(item.weightKg, 3),
      cbm: toNumericString(item.cbm, 6),
      arrivalAt: now,
      itemCostUsd: toNumericString(item.itemCostUsd, 2),
      requiresExtraTruckMovement: item.requiresExtraTruckMovement ?? false,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    }))

    await db.insert(orderPackages).values(goodsRows)

    const [totals] = await db
      .select({
        packageCount: sql<number>`count(*)::int`,
        totalWeight: sql<string>`coalesce(sum(${orderPackages.weightKg}), 0)::text`,
        totalCbm: sql<string>`coalesce(sum(${orderPackages.cbm}), 0)::text`,
        totalCost: sql<string>`coalesce(sum(${orderPackages.itemCostUsd}), 0)::text`,
      })
      .from(orderPackages)
      .where(eq(orderPackages.orderId, shipment.id))

    const packageMeasures = await db
      .select({
        weightKg: orderPackages.weightKg,
        cbm: orderPackages.cbm,
      })
      .from(orderPackages)
      .where(eq(orderPackages.orderId, shipment.id))

    const totalCbm = toNumber(totals?.totalCbm)
    const totalWeight = toNumber(totals?.totalWeight)

    const airChargeableWeightKg = round2(
      packageMeasures.reduce((sum, row) => {
        const weightKg = toNumber(row.weightKg)
        const cbm = toNumber(row.cbm)
        const volumetricKg = cbm > 0 ? (cbm * 1_000_000) / 6000 : 0
        return sum + Math.max(weightKg, volumetricKg)
      }, 0),
    )

    const seaChargeableWeightKg = round2(totalCbm * SEA_CBM_TO_KG_FACTOR)
    const rateOwnerId =
      shipmentPayer === ShipmentPayer.SUPPLIER
        ? (billingSupplierId as string)
        : input.customerId

    const pricing = await pricingV2Service.calculatePricing({
      customerId: rateOwnerId,
      mode: input.mode,
      weightKg:
        input.mode === TransportMode.AIR
          ? (airChargeableWeightKg > 0 ? airChargeableWeightKg : totalWeight)
          : seaChargeableWeightKg,
      cbm: input.mode === TransportMode.SEA ? totalCbm : undefined,
    })

    const [updatedShipment] = await db
      .update(orders)
      .set({
        packageCount: totals?.packageCount ?? shipment.packageCount,
        weight: totals?.totalWeight ?? shipment.weight,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, shipment.id))
      .returning()

    const invoice = await this.ensureDraftInvoiceForOrder({
      orderId: shipment.id,
      actorId: input.createdBy,
      totalUsd: pricing.amountUsd,
      shipmentPayer,
      billToUserId: shipmentPayer === ShipmentPayer.USER ? input.customerId : null,
      billToSupplierId: shipmentPayer === ShipmentPayer.SUPPLIER ? billingSupplierId : null,
    })

    return {
      batch,
      shipment: updatedShipment ?? shipment,
      invoice,
      appendedGoodsCount: goodsRows.length,
    }
  }

  async handleDepartureStatus(params: {
    orderId: string
    orderBatchId: string | null
    status: ShipmentStatusV2
    actorId: string
    actorRole: UserRole
  }) {
    if (!isDepartedStatus(params.status) || !params.orderBatchId) return

    await this.finalizeInvoicesForBatch({ batchId: params.orderBatchId, actorId: params.actorId })

    if (params.actorRole === UserRole.STAFF) {
      await this.requestCutoff(params.orderBatchId, params.actorId)
      return
    }

    if (params.actorRole === UserRole.SUPER_ADMIN) {
      await this.approveCutoff(params.orderBatchId, params.actorId)
    }
  }

  async getInternalTrackingByMasterTracking(masterTrackingNumber: string) {
    const [batch] = await db
      .select()
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.masterTrackingNumber, masterTrackingNumber), isNull(dispatchBatches.deletedAt)))
      .limit(1)

    if (!batch) return null

    const shipmentRows = await db
      .select({
        orderId: orders.id,
        trackingNumber: orders.trackingNumber,
        customerId: users.id,
        customerFirstName: users.firstName,
        customerLastName: users.lastName,
        customerBusinessName: users.businessName,
        statusV2: orders.statusV2,
        totalWeight: orders.weight,
        finalChargeUsd: orders.finalChargeUsd,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(users, eq(orders.senderId, users.id))
      .where(and(eq(orders.dispatchBatchId, batch.id), isNull(orders.deletedAt)))
      .orderBy(desc(orders.createdAt))

    const orderIds = shipmentRows.map((r) => r.orderId)
    const goods = orderIds.length
      ? await db
          .select({
            orderId: orderPackages.orderId,
            description: orderPackages.description,
            itemType: orderPackages.itemType,
            quantity: orderPackages.quantity,
            weightKg: orderPackages.weightKg,
            cbm: orderPackages.cbm,
            itemCostUsd: orderPackages.itemCostUsd,
            requiresExtraTruckMovement: orderPackages.requiresExtraTruckMovement,
            arrivalAt: orderPackages.arrivalAt,
            supplierId: users.id,
            supplierFirstName: users.firstName,
            supplierLastName: users.lastName,
            supplierBusinessName: users.businessName,
          })
          .from(orderPackages)
          .leftJoin(users, eq(orderPackages.supplierId, users.id))
          .where(inArray(orderPackages.orderId, orderIds))
      : []

    const measurements = orderIds.length
      ? await db
          .select()
          .from(shipmentMeasurements)
          .where(inArray(shipmentMeasurements.orderId, orderIds))
      : []

    const goodsByOrder = new Map<string, typeof goods>()
    for (const g of goods) {
      const list = goodsByOrder.get(g.orderId ?? '') ?? []
      list.push(g)
      goodsByOrder.set(g.orderId ?? '', list)
    }

    const measurementsByOrder = new Map<string, typeof measurements>()
    for (const measurement of measurements) {
      const list = measurementsByOrder.get(measurement.orderId) ?? []
      list.push(measurement)
      measurementsByOrder.set(measurement.orderId, list)
    }

    const shipments = shipmentRows.map((row) => ({
      orderId: row.orderId,
      customerTrackingNumber: row.trackingNumber,
      customerId: row.customerId,
      customerName: formatUserDisplayName({
        firstName: row.customerFirstName,
        lastName: row.customerLastName,
        businessName: row.customerBusinessName,
      }),
      statusV2: row.statusV2,
      totalWeightKg: row.totalWeight,
      finalChargeUsd: row.finalChargeUsd,
      goods: (goodsByOrder.get(row.orderId) ?? []).map((g) => ({
        description: g.description,
        itemType: g.itemType,
        quantity: g.quantity,
        weightKg: g.weightKg,
        cbm: g.cbm,
        itemCostUsd: g.itemCostUsd,
        requiresExtraTruckMovement: g.requiresExtraTruckMovement,
        arrivalAt: g.arrivalAt?.toISOString() ?? null,
        supplierId: g.supplierId,
        supplierName: formatUserDisplayName({
          firstName: g.supplierFirstName,
          lastName: g.supplierLastName,
          businessName: g.supplierBusinessName,
        }),
      })),
      measurements: (measurementsByOrder.get(row.orderId) ?? []).map((m) => ({
        checkpoint: m.checkpoint,
        measuredWeightKg: m.measuredWeightKg,
        measuredCbm: m.measuredCbm,
        deltaFromSkWeightKg: m.deltaFromSkWeightKg,
        deltaFromSkCbm: m.deltaFromSkCbm,
        measuredAt: m.measuredAt.toISOString(),
        notes: m.notes,
      })),
    }))

    return {
      batch: this.mapBatch(batch),
      shipments,
    }
  }

  async getInvoiceByOrderId(orderId: string) {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.orderId, orderId))
      .limit(1)

    return invoice ?? null
  }

  async getPaymentStatusForInvoice(invoiceId: string) {
    const [summary] = await db
      .select({
        successfulCount: sql<number>`count(*) filter (where ${payments.status} = 'successful')::int`,
      })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId))

    if (!summary || summary.successfulCount === 0) return 'pending'
    return 'completed'
  }

  async moveGoodsToNextBatch(params: {
    sourceBatchId: string
    orderId: string
    movedBy: string
    supplierId?: string
    packageIds?: string[]
  }) {
    const [sourceOrder] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, params.orderId),
          eq(orders.dispatchBatchId, params.sourceBatchId),
          isNull(orders.deletedAt),
        ),
      )
      .limit(1)

    if (!sourceOrder) {
      throw new Error('Order not found in the specified batch.')
    }

    if (!sourceOrder.transportMode) {
      throw new Error('Order has no transport mode and cannot be moved between batches.')
    }

    const [sourceBatch] = await db
      .select()
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, params.sourceBatchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)

    if (!sourceBatch) {
      throw new Error('Source batch not found.')
    }

    if (sourceBatch.status === 'closed') {
      throw new Error('Closed batches cannot be modified.')
    }

    if (params.supplierId && params.packageIds && params.packageIds.length > 0) {
      throw new Error('Provide either supplierId or packageIds, not both.')
    }

    const allPackages = await db
      .select()
      .from(orderPackages)
      .where(eq(orderPackages.orderId, sourceOrder.id))

    if (allPackages.length === 0) {
      throw new Error('Order has no goods lines to move.')
    }

    let selected = allPackages
    if (params.supplierId) {
      selected = allPackages.filter((pkg) => pkg.supplierId === params.supplierId)
    }
    if (params.packageIds && params.packageIds.length > 0) {
      const allowed = new Set(params.packageIds)
      selected = allPackages.filter((pkg) => allowed.has(pkg.id))
    }

    if (selected.length === 0) {
      throw new Error('No goods lines matched the selection.')
    }

    const nextBatch = await this.getOrCreateFutureBatch(
      sourceOrder.transportMode as TransportMode,
      params.movedBy,
      params.sourceBatchId,
    )

    const allSelected = selected.length === allPackages.length
    const selectedIds = selected.map((pkg) => pkg.id)

    const [compatibleTarget] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.dispatchBatchId, nextBatch.id),
          eq(orders.senderId, sourceOrder.senderId),
          eq(orders.transportMode, sourceOrder.transportMode),
          sourceOrder.shipmentType
            ? eq(orders.shipmentType, sourceOrder.shipmentType)
            : isNull(orders.shipmentType),
          eq(orders.shipmentPayer, sourceOrder.shipmentPayer),
          sourceOrder.billingSupplierId
            ? eq(orders.billingSupplierId, sourceOrder.billingSupplierId)
            : isNull(orders.billingSupplierId),
          isNull(orders.deletedAt),
        ),
      )
      .limit(1)

    let targetOrder = compatibleTarget

    if (allSelected && !targetOrder) {
      const [movedWhole] = await db
        .update(orders)
        .set({
          dispatchBatchId: nextBatch.id,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, sourceOrder.id))
        .returning()

      await this.recomputeOrderTotalsAndInvoice(sourceOrder.id, params.movedBy)

      return {
        sourceBatchId: params.sourceBatchId,
        nextBatchId: nextBatch.id,
        nextBatchMasterTrackingNumber: nextBatch.masterTrackingNumber,
        sourceOrderId: sourceOrder.id,
        targetOrderId: movedWhole?.id ?? sourceOrder.id,
        movedPackageCount: selected.length,
        movedPackageIds: selectedIds,
        movedWholeOrder: true,
      }
    }

    if (!targetOrder) {
      const [createdTarget] = await db
        .insert(orders)
        .values({
          trackingNumber: generateTrackingNumber(),
          senderId: sourceOrder.senderId,
          recipientName: sourceOrder.recipientName,
          recipientAddress: sourceOrder.recipientAddress,
          recipientPhone: sourceOrder.recipientPhone,
          recipientEmail: sourceOrder.recipientEmail,
          origin: sourceOrder.origin,
          destination: sourceOrder.destination,
          orderDirection: sourceOrder.orderDirection,
          weight: sourceOrder.weight,
          declaredValue: sourceOrder.declaredValue,
          description: sourceOrder.description,
          shipmentType: sourceOrder.shipmentType,
          shipmentPayer: sourceOrder.shipmentPayer,
          billingSupplierId: sourceOrder.billingSupplierId,
          departureDate: sourceOrder.departureDate,
          eta: sourceOrder.eta,
          transportMode: sourceOrder.transportMode,
          isPreorder: sourceOrder.isPreorder,
          statusV2: sourceOrder.statusV2,
          customerStatusV2: sourceOrder.customerStatusV2,
          createdBy: params.movedBy,
          dispatchBatchId: nextBatch.id,
          packageCount: 0,
        })
        .returning()

      targetOrder = createdTarget
    }

    await db
      .update(orderPackages)
      .set({
        orderId: targetOrder.id,
        updatedBy: params.movedBy,
        updatedAt: new Date(),
      })
      .where(inArray(orderPackages.id, selectedIds))

    await this.recomputeOrderTotalsAndInvoice(targetOrder.id, params.movedBy)
    await this.recomputeOrderTotalsAndInvoice(sourceOrder.id, params.movedBy)

    return {
      sourceBatchId: params.sourceBatchId,
      nextBatchId: nextBatch.id,
      nextBatchMasterTrackingNumber: nextBatch.masterTrackingNumber,
      sourceOrderId: sourceOrder.id,
      targetOrderId: targetOrder.id,
      movedPackageCount: selected.length,
      movedPackageIds: selectedIds,
      movedWholeOrder: allSelected,
    }
  }

  private async recomputeOrderTotalsAndInvoice(orderId: string, actorId: string) {
    const [order] = await db
      .select({
        id: orders.id,
        senderId: orders.senderId,
        transportMode: orders.transportMode,
        shipmentPayer: orders.shipmentPayer,
        billingSupplierId: orders.billingSupplierId,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1)

    if (!order) return

    const packages = await db
      .select({
        weightKg: orderPackages.weightKg,
        cbm: orderPackages.cbm,
      })
      .from(orderPackages)
      .where(eq(orderPackages.orderId, orderId))

    if (packages.length === 0) {
      await db
        .update(orders)
        .set({
          packageCount: 0,
          weight: '0',
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
      return
    }

    const totalWeightKg = round2(
      packages.reduce((sum, pkg) => sum + toNumber(pkg.weightKg), 0),
    )
    const totalCbm = round2(
      packages.reduce((sum, pkg) => sum + toNumber(pkg.cbm), 0),
    )

    await db
      .update(orders)
      .set({
        packageCount: packages.length,
        weight: totalWeightKg.toFixed(3),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))

    if (!order.transportMode) return

    const mode = order.transportMode as TransportMode
    const chargeableWeight =
      mode === TransportMode.AIR
        ? round2(
            packages.reduce((sum, pkg) => {
              const actual = toNumber(pkg.weightKg)
              const cbm = toNumber(pkg.cbm)
              const volumetric = cbm > 0 ? (cbm * 1_000_000) / 6000 : 0
              return sum + Math.max(actual, volumetric)
            }, 0),
          )
        : round2(totalCbm * SEA_CBM_TO_KG_FACTOR)

    const rateOwnerId =
      order.shipmentPayer === ShipmentPayer.SUPPLIER
        ? (order.billingSupplierId ?? order.senderId)
        : order.senderId

    const pricing = await pricingV2Service.calculatePricing({
      customerId: rateOwnerId,
      mode,
      weightKg: chargeableWeight,
      cbm: mode === TransportMode.SEA ? totalCbm : undefined,
    })

    await this.ensureDraftInvoiceForOrder({
      orderId,
      actorId,
      totalUsd: pricing.amountUsd,
      shipmentPayer: order.shipmentPayer as ShipmentPayer,
      billToUserId: order.shipmentPayer === ShipmentPayer.USER ? order.senderId : null,
      billToSupplierId: order.shipmentPayer === ShipmentPayer.SUPPLIER ? order.billingSupplierId : null,
    })
  }

  private mapBatch(batch: typeof dispatchBatches.$inferSelect) {
    return {
      id: batch.id,
      masterTrackingNumber: batch.masterTrackingNumber,
      transportMode: batch.transportMode,
      status: batch.status,
      carrierName: batch.carrierName,
      airlineTrackingNumber: batch.airlineTrackingNumber,
      oceanTrackingNumber: batch.oceanTrackingNumber,
      d2dTrackingNumber: batch.d2dTrackingNumber,
      voyageOrFlightNumber: batch.voyageOrFlightNumber,
      estimatedDepartureAt: batch.estimatedDepartureAt?.toISOString() ?? null,
      estimatedArrivalAt: batch.estimatedArrivalAt?.toISOString() ?? null,
      notes: batch.notes,
      cutoffRequestedAt: batch.cutoffRequestedAt?.toISOString() ?? null,
      cutoffApprovedAt: batch.cutoffApprovedAt?.toISOString() ?? null,
      closedAt: batch.closedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    }
  }
}

export const dispatchBatchesService = new DispatchBatchesService()
