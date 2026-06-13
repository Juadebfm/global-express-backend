import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../config/db'
import {
  batchCustomerSlots,
  dispatchBatches,
  invoices,
  orders,
  users,
} from '../../drizzle/schema'
import { DispatchBatchStatus, ShipmentStatusV2 } from '../types/enums'
import { decrypt } from '../utils/encryption'
import { dispatchBatchesService } from './dispatch-batches.service'
import { notifyUser } from './notifications.service'
import { randomBytes } from 'crypto'

// ─── Status labels ────────────────────────────────────────────────────────────
// Plain English labels for every order status — shown to staff and customers.

export const STATUS_LABELS: Record<string, { label: string; description: string }> = {
  PREORDER_SUBMITTED: {
    label: 'Pre-order received',
    description: 'We have received your order and are waiting for your goods to arrive at our warehouse.',
  },
  AWAITING_WAREHOUSE_RECEIPT: {
    label: 'Waiting to arrive at warehouse',
    description: 'Your goods are expected at our warehouse. We will notify you once they arrive.',
  },
  WAREHOUSE_RECEIVED: {
    label: 'Arrived at warehouse',
    description: 'Your goods have arrived at our warehouse and are being checked.',
  },
  CLAIM_APPROVED_PENDING_BULK_PROCESSING: {
    label: 'Claim approved — being processed',
    description: 'Your claim has been approved. Your goods are being prepared for shipment.',
  },
  WAREHOUSE_VERIFIED_PRICED: {
    label: 'Verified and priced',
    description: 'Your goods have been inspected and priced. They are ready to be shipped.',
  },
  DISPATCHED_TO_ORIGIN_AIRPORT: {
    label: 'Sent to the airport',
    description: 'Your goods are on their way to the airport.',
  },
  AT_ORIGIN_AIRPORT: {
    label: 'At the airport',
    description: 'Your goods are at the origin airport, waiting for the flight.',
  },
  BOARDED_ON_FLIGHT: {
    label: 'Loaded onto the flight',
    description: 'Your goods have been loaded onto the plane.',
  },
  FLIGHT_DEPARTED: {
    label: 'In the air',
    description: 'Your goods are on their way to Lagos.',
  },
  FLIGHT_LANDED_LAGOS: {
    label: 'Landed in Lagos',
    description: 'The flight has landed in Lagos. Your goods are being offloaded.',
  },
  DISPATCHED_TO_ORIGIN_PORT: {
    label: 'Sent to the port',
    description: 'Your goods are on their way to the origin seaport.',
  },
  AT_ORIGIN_PORT: {
    label: 'At the port',
    description: 'Your goods are at the origin seaport, waiting to be loaded onto the ship.',
  },
  LOADED_ON_VESSEL: {
    label: 'Loaded onto the ship',
    description: 'Your goods have been loaded onto the vessel.',
  },
  VESSEL_DEPARTED: {
    label: 'Ship has departed',
    description: 'The vessel has left port and is heading to Lagos.',
  },
  VESSEL_ARRIVED_LAGOS_PORT: {
    label: 'Arrived at Lagos port',
    description: 'The ship has arrived at Lagos port.',
  },
  CUSTOMS_CLEARED_LAGOS: {
    label: 'Customs cleared',
    description: 'Your goods have cleared customs in Lagos.',
  },
  IN_TRANSIT_TO_LAGOS_OFFICE: {
    label: 'On the way to our office',
    description: 'Your goods are being transported to our Lagos office.',
  },
  IN_EXTRA_TRUCK_MOVEMENT_LAGOS: {
    label: 'Additional movement in Lagos',
    description: 'Your goods are in transit to our office via an additional vehicle.',
  },
  READY_FOR_PICKUP: {
    label: 'Ready for collection',
    description: 'Your goods are at our Lagos office. You can come and collect them.',
  },
  PICKED_UP_COMPLETED: {
    label: 'Collected',
    description: 'Your goods have been collected. Thank you!',
  },
  LOCAL_COURIER_ASSIGNED: {
    label: 'Courier assigned for delivery',
    description: 'A courier has been assigned to bring your goods to your door.',
  },
  IN_TRANSIT_TO_DESTINATION_CITY: {
    label: 'On the way to you',
    description: 'Your goods are on their way to your location.',
  },
  OUT_FOR_DELIVERY_DESTINATION_CITY: {
    label: 'Out for delivery',
    description: 'Your goods are almost there — the delivery is on its way to your door.',
  },
  DELIVERED_TO_RECIPIENT: {
    label: 'Delivered to your door',
    description: 'Your goods have been delivered. Thank you!',
  },
  ON_HOLD: {
    label: 'On hold',
    description: 'Your goods are temporarily on hold. Please contact us for more information.',
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'This order has been cancelled.',
  },
  RESTRICTED_ITEM_REJECTED: {
    label: 'Rejected — restricted item',
    description: 'Your goods were rejected because they contain items that cannot be shipped.',
  },
  RESTRICTED_ITEM_OVERRIDE_APPROVED: {
    label: 'Restriction override approved',
    description: 'The restriction on your goods has been reviewed and approved.',
  },
}

const BATCH_STATUS_LABELS: Record<string, string> = {
  open: 'Accepting goods',
  cutoff_pending_approval: 'Sealed — waiting for approval',
  closed: 'Closed and dispatched',
}

const TRANSPORT_LABELS: Record<string, string> = {
  air: 'Air freight',
  sea: 'Ocean freight',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateMasterTrackingNumber(transportMode: string): string {
  const mode = transportMode.toUpperCase()
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rand = randomBytes(3).toString('hex').toUpperCase()
  return `GEX-MASTER-${mode}-${date}-${rand}`
}

// D2D travels by air; all other orders use their declared transport mode.
function orderBatchMode(order: {
  transportMode: string | null
  shipmentType: string | null
}): 'air' | 'sea' {
  if (order.shipmentType === 'd2d') return 'air'
  if (order.transportMode === 'sea') return 'sea'
  return 'air'
}

function safeDecrypt(val: string | null): string | null {
  if (!val) return null
  try { return decrypt(val) } catch { return null }
}

function mapBatch(b: typeof dispatchBatches.$inferSelect) {
  return {
    id: b.id,
    masterTrackingNumber: b.masterTrackingNumber,
    transportMode: b.transportMode,
    transportLabel: TRANSPORT_LABELS[b.transportMode] ?? b.transportMode,
    status: b.status,
    statusLabel: BATCH_STATUS_LABELS[b.status] ?? b.status,
    carrierName: b.carrierName,
    airlineTrackingNumber: b.airlineTrackingNumber,
    oceanTrackingNumber: b.oceanTrackingNumber,
    d2dTrackingNumber: b.d2dTrackingNumber,
    voyageOrFlightNumber: b.voyageOrFlightNumber,
    estimatedDepartureAt: b.estimatedDepartureAt?.toISOString() ?? null,
    estimatedArrivalAt: b.estimatedArrivalAt?.toISOString() ?? null,
    closedAt: b.closedAt?.toISOString() ?? null,
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class BatchesService {

  // ── 1. Create a batch ────────────────────────────────────────────────────

  async createBatch(params: { transportMode: 'air' | 'sea'; actorId: string }) {
    const masterTrackingNumber = generateMasterTrackingNumber(params.transportMode)

    const [batch] = await db
      .insert(dispatchBatches)
      .values({
        masterTrackingNumber,
        transportMode: params.transportMode,
        status: DispatchBatchStatus.OPEN,
        createdBy: params.actorId,
      })
      .returning()

    return mapBatch(batch)
  }

  // ── 2. List batches ──────────────────────────────────────────────────────

  async listBatches(params: {
    status?: string
    transportMode?: string
    page: number
    limit: number
  }) {
    const { page, limit } = params
    const conditions = [isNull(dispatchBatches.deletedAt)]
    if (params.status) conditions.push(eq(dispatchBatches.status, params.status as DispatchBatchStatus))
    if (params.transportMode) conditions.push(eq(dispatchBatches.transportMode, params.transportMode))

    const where = and(...conditions)

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          batch: dispatchBatches,
          customerCount: sql<number>`(
            SELECT count(*)::int FROM batch_customer_slots bcs WHERE bcs.batch_id = ${dispatchBatches.id}
          )`,
          orderCount: sql<number>`(
            SELECT count(*)::int FROM orders o WHERE o.dispatch_batch_id = ${dispatchBatches.id} AND o.deleted_at IS NULL
          )`,
          totalWeightKg: sql<string>`(
            SELECT coalesce(sum(o.weight), 0)::text FROM orders o WHERE o.dispatch_batch_id = ${dispatchBatches.id} AND o.deleted_at IS NULL
          )`,
        })
        .from(dispatchBatches)
        .where(where)
        .orderBy(desc(dispatchBatches.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(dispatchBatches).where(where),
    ])

    return {
      batches: rows.map((r) => ({
        ...mapBatch(r.batch),
        customerCount: r.customerCount,
        orderCount: r.orderCount,
        totalWeightKg: r.totalWeightKg,
      })),
      pagination: {
        page,
        limit,
        total: totalResult[0]?.total ?? 0,
        totalPages: Math.ceil((totalResult[0]?.total ?? 0) / limit),
      },
    }
  }

  // ── 3. Full batch roster ─────────────────────────────────────────────────

  async getBatchRoster(batchId: string) {
    const [batch] = await db
      .select()
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, batchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)

    if (!batch) return null

    // Get all slots with customer info
    const slots = await db
      .select({
        slotId: batchCustomerSlots.id,
        customerId: batchCustomerSlots.customerId,
        primaryTrackingNumber: batchCustomerSlots.primaryTrackingNumber,
        slotCreatedAt: batchCustomerSlots.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        shippingMark: users.shippingMark,
      })
      .from(batchCustomerSlots)
      .leftJoin(users, eq(batchCustomerSlots.customerId, users.id))
      .where(eq(batchCustomerSlots.batchId, batchId))
      .orderBy(asc(batchCustomerSlots.createdAt))

    // Get all orders in this batch
    const batchOrders = await db
      .select({
        id: orders.id,
        trackingNumber: orders.trackingNumber,
        statusV2: orders.statusV2,
        description: orders.description,
        weight: orders.weight,
        shipmentType: orders.shipmentType,
        transportMode: orders.transportMode,
        declaredValueUsd: orders.declaredValue,
        createdAt: orders.createdAt,
        senderId: orders.senderId,
      })
      .from(orders)
      .where(and(eq(orders.dispatchBatchId, batchId), isNull(orders.deletedAt)))
      .orderBy(asc(orders.createdAt))

    // Group orders by customer
    const ordersByCustomer = new Map<string, typeof batchOrders>()
    for (const o of batchOrders) {
      if (!o.senderId) continue
      const existing = ordersByCustomer.get(o.senderId) ?? []
      existing.push(o)
      ordersByCustomer.set(o.senderId, existing)
    }

    // Goods type breakdown across whole batch
    const goodsTypeBreakdown: Record<string, number> = {}
    let totalWeightKg = 0
    let unverifiedCount = 0
    let d2dCount = 0
    let airCount = 0

    const customers = slots.map((slot) => {
      const customerOrders = ordersByCustomer.get(slot.customerId) ?? []
      const allVerified = customerOrders.every(
        (o) => o.statusV2 === ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
      )

      const customerGoodsTypes = new Set<string>()
      let customerWeight = 0

      for (const o of customerOrders) {
        const w = parseFloat(o.weight ?? '0')
        customerWeight += w
        totalWeightKg += w

        if (o.statusV2 !== ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED) unverifiedCount++
        if (o.shipmentType === 'd2d') d2dCount++
        else airCount++

        customerGoodsTypes.add(o.shipmentType ?? 'standard')
        goodsTypeBreakdown[o.shipmentType ?? 'standard'] =
          (goodsTypeBreakdown[o.shipmentType ?? 'standard'] ?? 0) + 1
      }

      return {
        slotId: slot.slotId,
        customerId: slot.customerId,
        customerName: [safeDecrypt(slot.firstName), safeDecrypt(slot.lastName)]
          .filter(Boolean)
          .join(' ') || 'Unknown',
        shippingMark: slot.shippingMark,
        batchTrackingNumber: slot.primaryTrackingNumber,
        orderCount: customerOrders.length,
        totalWeightKg: customerWeight.toFixed(3),
        allVerified,
        orders: customerOrders.map((o) => ({
          id: o.id,
          trackingNumber: o.trackingNumber,
          status: o.statusV2,
          statusLabel: STATUS_LABELS[o.statusV2 ?? '']?.label ?? o.statusV2,
          description: o.description,
          weightKg: o.weight,
          shipmentType: o.shipmentType,
          shipmentTypeLabel:
            o.shipmentType === 'd2d'
              ? 'Door-to-door'
              : o.shipmentType === 'ocean'
                ? 'Ocean freight'
                : 'Air freight',
          declaredValueUsd: o.declaredValueUsd,
          createdAt: o.createdAt.toISOString(),
        })),
      }
    })

    return {
      batch: mapBatch(batch),
      customers,
      summary: {
        totalCustomers: slots.length,
        totalOrders: batchOrders.length,
        totalWeightKg: totalWeightKg.toFixed(3),
        unverifiedOrders: unverifiedCount,
        canClose: unverifiedCount === 0 && batchOrders.length > 0,
        shipmentTypeBreakdown: { air: airCount, d2d: d2dCount },
        goodsTypeBreakdown,
      },
    }
  }

  // ── 4. Add an order to a batch ───────────────────────────────────────────

  async addOrderToBatch(params: { orderId: string; actorId: string }) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, params.orderId), isNull(orders.deletedAt)))
      .limit(1)

    if (!order) {
      return { ok: false as const, reason: 'Order not found' }
    }

    if (order.statusV2 !== ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED) {
      return {
        ok: false as const,
        reason: 'This order has not been verified and priced yet. Only verified and priced orders can be added to a batch.',
      }
    }

    if (order.dispatchBatchId) {
      return {
        ok: false as const,
        reason: 'This order is already in a batch.',
      }
    }

    if (!order.senderId) {
      return { ok: false as const, reason: 'Order has no customer assigned.' }
    }

    // Find the open batch for this transport mode
    const batchMode = orderBatchMode({ transportMode: order.transportMode, shipmentType: order.shipmentType })

    const [openBatch] = await db
      .select()
      .from(dispatchBatches)
      .where(
        and(
          eq(dispatchBatches.status, DispatchBatchStatus.OPEN),
          eq(dispatchBatches.transportMode, batchMode),
          isNull(dispatchBatches.deletedAt),
        ),
      )
      .orderBy(asc(dispatchBatches.createdAt))
      .limit(1)

    if (!openBatch) {
      return {
        ok: false as const,
        reason: `No open ${batchMode === 'air' ? 'air' : 'ocean'} batch found. Please ask a staff member to open a new batch first.`,
      }
    }

    // Check if customer already has a slot in this batch
    const [existingSlot] = await db
      .select()
      .from(batchCustomerSlots)
      .where(
        and(
          eq(batchCustomerSlots.batchId, openBatch.id),
          eq(batchCustomerSlots.customerId, order.senderId),
        ),
      )
      .limit(1)

    if (!existingSlot) {
      // First order for this customer in this batch — create their slot
      await db.insert(batchCustomerSlots).values({
        batchId: openBatch.id,
        customerId: order.senderId,
        primaryTrackingNumber: order.trackingNumber,
      })
    }

    // Link the order to the batch
    await db
      .update(orders)
      .set({ dispatchBatchId: openBatch.id, updatedAt: new Date() })
      .where(eq(orders.id, params.orderId))

    const slot = existingSlot ?? (
      await db
        .select()
        .from(batchCustomerSlots)
        .where(
          and(
            eq(batchCustomerSlots.batchId, openBatch.id),
            eq(batchCustomerSlots.customerId, order.senderId),
          ),
        )
        .limit(1)
    )[0]

    return {
      ok: true as const,
      batchId: openBatch.id,
      masterTrackingNumber: openBatch.masterTrackingNumber,
      batchTrackingNumber: slot?.primaryTrackingNumber ?? order.trackingNumber,
      isNewSlot: !existingSlot,
    }
  }

  // ── 5. Remove an order from a batch ─────────────────────────────────────

  async removeOrderFromBatch(params: { batchId: string; orderId: string }) {
    const [batch] = await db
      .select()
      .from(dispatchBatches)
      .where(eq(dispatchBatches.id, params.batchId))
      .limit(1)

    if (!batch) return { ok: false as const, reason: 'Batch not found.' }

    if (batch.status !== DispatchBatchStatus.OPEN) {
      return {
        ok: false as const,
        reason: 'Orders can only be removed from batches that are still open.',
      }
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, params.orderId), eq(orders.dispatchBatchId, params.batchId)))
      .limit(1)

    if (!order) return { ok: false as const, reason: 'Order not found in this batch.' }

    // Detach order from batch
    await db
      .update(orders)
      .set({ dispatchBatchId: null, updatedAt: new Date() })
      .where(eq(orders.id, params.orderId))

    // Check if customer has any other orders in this batch
    if (order.senderId) {
      const [remaining] = await db
        .select({ c: count() })
        .from(orders)
        .where(
          and(
            eq(orders.dispatchBatchId, params.batchId),
            eq(orders.senderId, order.senderId),
            isNull(orders.deletedAt),
          ),
        )

      if ((remaining?.c ?? 0) === 0) {
        // No more orders for this customer — remove their slot
        await db
          .delete(batchCustomerSlots)
          .where(
            and(
              eq(batchCustomerSlots.batchId, params.batchId),
              eq(batchCustomerSlots.customerId, order.senderId),
            ),
          )
      }
    }

    return { ok: true as const }
  }

  // ── 6. Update batch status — cascades to all orders ──────────────────────

  async updateBatchStatus(params: {
    batchId: string
    newStatus: ShipmentStatusV2
    actorId: string
  }) {
    const [batch] = await db
      .select()
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, params.batchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)

    if (!batch) return { ok: false as const, reason: 'Batch not found.' }

    if (batch.status !== DispatchBatchStatus.CLOSED) {
      return {
        ok: false as const,
        reason: 'Status can only be updated on a closed batch. Close the batch first.',
      }
    }

    // Cascade status to all orders in the batch
    const updatedOrders = await db
      .update(orders)
      .set({ statusV2: params.newStatus, updatedAt: new Date() })
      .where(and(eq(orders.dispatchBatchId, params.batchId), isNull(orders.deletedAt)))
      .returning({ id: orders.id, senderId: orders.senderId, trackingNumber: orders.trackingNumber })

    // Notify each customer (fire-and-forget)
    const customersSeen = new Set<string>()
    for (const o of updatedOrders) {
      if (!o.senderId || customersSeen.has(o.senderId)) continue
      customersSeen.add(o.senderId)

      const label = STATUS_LABELS[params.newStatus]?.label ?? params.newStatus
      const description = STATUS_LABELS[params.newStatus]?.description ?? ''

      void notifyUser({
        userId: o.senderId,
        type: 'order_status_update',
        title: `Your shipment update: ${label}`,
        body: description,
        metadata: {
          batchId: params.batchId,
          masterTrackingNumber: batch.masterTrackingNumber,
          status: params.newStatus,
        },
      })
    }

    return {
      ok: true as const,
      updatedOrderCount: updatedOrders.length,
      newStatus: params.newStatus,
      statusLabel: STATUS_LABELS[params.newStatus]?.label ?? params.newStatus,
    }
  }

  // ── 7. Close a batch ─────────────────────────────────────────────────────

  async closeBatch(params: { batchId: string; actorId: string }) {
    const [batch] = await db
      .select()
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, params.batchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)

    if (!batch) return { ok: false as const, reason: 'Batch not found.' }

    if (batch.status === DispatchBatchStatus.CLOSED) {
      return { ok: false as const, reason: 'This batch is already closed.' }
    }

    // Guard: every order in the batch must be verified and priced
    const unverified = await db
      .select({ id: orders.id, trackingNumber: orders.trackingNumber })
      .from(orders)
      .where(
        and(
          eq(orders.dispatchBatchId, params.batchId),
          isNull(orders.deletedAt),
          sql`status_v2 != ${ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED}`,
        ),
      )

    if (unverified.length > 0) {
      return {
        ok: false as const,
        reason: `${unverified.length} order(s) in this batch have not been verified and priced yet. All goods must be verified and priced before the batch can be closed.`,
        unverifiedOrders: unverified.map((o) => o.trackingNumber),
      }
    }

    const orderCount = await db
      .select({ c: count() })
      .from(orders)
      .where(and(eq(orders.dispatchBatchId, params.batchId), isNull(orders.deletedAt)))

    if ((orderCount[0]?.c ?? 0) === 0) {
      return { ok: false as const, reason: 'Cannot close an empty batch.' }
    }

    // Close the batch
    const [closedBatch] = await db
      .update(dispatchBatches)
      .set({
        status: DispatchBatchStatus.CLOSED,
        cutoffApprovedBy: params.actorId,
        cutoffApprovedAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dispatchBatches.id, params.batchId))
      .returning()

    // Finalize invoices for all orders in the batch
    await dispatchBatchesService.finalizeInvoicesForBatch({
      batchId: params.batchId,
      actorId: params.actorId,
    })

    // Auto-open the next batch of the same transport mode
    const nextBatch = await this.createBatch({
      transportMode: batch.transportMode as 'air' | 'sea',
      actorId: params.actorId,
    })

    // Send payment notification to every customer in the batch
    const slots = await db
      .select({
        customerId: batchCustomerSlots.customerId,
        primaryTrackingNumber: batchCustomerSlots.primaryTrackingNumber,
      })
      .from(batchCustomerSlots)
      .where(eq(batchCustomerSlots.batchId, params.batchId))

    for (const slot of slots) {
      // Get the total due for this customer across all their orders in this batch
      const customerInvoices = await db
        .select({ totalUsd: invoices.totalUsd })
        .from(invoices)
        .leftJoin(orders, eq(orders.id, invoices.orderId))
        .where(
          and(
            eq(orders.dispatchBatchId, params.batchId),
            eq(invoices.billToUserId, slot.customerId),
            sql`invoices.status IN ('finalized', 'draft')`,
          ),
        )

      const totalUsd = customerInvoices
        .reduce((sum, inv) => sum + parseFloat(inv.totalUsd ?? '0'), 0)
        .toFixed(2)

      void notifyUser({
        userId: slot.customerId,
        type: 'payment_event',
        title: 'Your shipment is locked in — payment is now due',
        body: `Your goods (tracking: ${slot.primaryTrackingNumber}) have been sealed into a batch and are ready to ship. Your total balance is $${totalUsd}. Please log in to make your payment.`,
        metadata: {
          batchId: params.batchId,
          masterTrackingNumber: batch.masterTrackingNumber,
          batchTrackingNumber: slot.primaryTrackingNumber,
          totalUsd,
        },
      })
    }

    return {
      ok: true as const,
      closedBatch: mapBatch(closedBatch),
      nextBatch,
      customersNotified: slots.length,
    }
  }

  // ── 8. Get single batch (summary only, no roster) ────────────────────────

  async getBatch(batchId: string) {
    const [batch] = await db
      .select()
      .from(dispatchBatches)
      .where(and(eq(dispatchBatches.id, batchId), isNull(dispatchBatches.deletedAt)))
      .limit(1)

    if (!batch) return null
    return mapBatch(batch)
  }
}

export const batchesService = new BatchesService()
