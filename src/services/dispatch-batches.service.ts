import { randomBytes } from 'crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../config/db'
import {
  dispatchBatches,
  invoices,
  orderPackages,
  orders,
  payments,
  users,
} from '../../drizzle/schema'
import { decrypt, encrypt } from '../utils/encryption'
import { ShipmentStatusV2, TransportMode, UserRole } from '../types/enums'
import { settingsFxRateService } from './settings-fx-rate.service'

const FINALIZABLE_INVOICE_STATUSES: Array<'draft' | 'finalized'> = ['draft', 'finalized']
const DEPARTED_STATUSES = new Set<ShipmentStatusV2>([
  ShipmentStatusV2.FLIGHT_DEPARTED,
  ShipmentStatusV2.VESSEL_DEPARTED,
])

export interface IntakeGoodsInput {
  customerId: string
  mode: TransportMode
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
  }>
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function inferShipmentType(mode: TransportMode): 'air' | 'ocean' {
  return mode === TransportMode.AIR ? 'air' : 'ocean'
}

function toNumericString(value: number | null | undefined, decimals = 2): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return value.toFixed(decimals)
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
      .orderBy(desc(dispatchBatches.createdAt))
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

  async ensureDraftInvoiceForOrder(params: {
    orderId: string
    actorId: string
    totalUsd?: number
  }) {
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
            shipmentType: inferShipmentType(input.mode),
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
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    }))

    await db.insert(orderPackages).values(goodsRows)

    const [totals] = await db
      .select({
        packageCount: sql<number>`count(*)::int`,
        totalWeight: sql<string>`coalesce(sum(${orderPackages.weightKg}), 0)::text`,
        totalCost: sql<string>`coalesce(sum(${orderPackages.itemCostUsd}), 0)::text`,
      })
      .from(orderPackages)
      .where(eq(orderPackages.orderId, shipment.id))

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
      totalUsd: Number(totals?.totalCost ?? 0),
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

    const goodsByOrder = new Map<string, typeof goods>()
    for (const g of goods) {
      const list = goodsByOrder.get(g.orderId ?? '') ?? []
      list.push(g)
      goodsByOrder.set(g.orderId ?? '', list)
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
        arrivalAt: g.arrivalAt?.toISOString() ?? null,
        supplierId: g.supplierId,
        supplierName: formatUserDisplayName({
          firstName: g.supplierFirstName,
          lastName: g.supplierLastName,
          businessName: g.supplierBusinessName,
        }),
      })),
    }))

    return {
      batch: {
        id: batch.id,
        masterTrackingNumber: batch.masterTrackingNumber,
        transportMode: batch.transportMode,
        status: batch.status,
        cutoffRequestedAt: batch.cutoffRequestedAt?.toISOString() ?? null,
        cutoffApprovedAt: batch.cutoffApprovedAt?.toISOString() ?? null,
        closedAt: batch.closedAt?.toISOString() ?? null,
        createdAt: batch.createdAt.toISOString(),
      },
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
}

export const dispatchBatchesService = new DispatchBatchesService()
