import { eq, and, isNull, sql, desc } from 'drizzle-orm'
import { db } from '../config/db'
import {
  orders,
  packageImages,
  bulkShipmentItems,
  bulkShipments,
  orderPackages,
} from '../../drizzle/schema'
import { encrypt, decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { generateTrackingNumber } from '../utils/tracking'
import { broadcastToUser } from '../websocket/handlers'
import { sendOrderStatusUpdateEmail } from '../notifications/email'
import { sendOrderStatusWhatsApp } from '../notifications/whatsapp'
import { notifyUser } from './notifications.service'
import { orderStatusEventsService } from './order-status-events.service'
import { pricingV2Service } from './pricing-v2.service'
import {
  mapLegacyStatusToV2,
  normalizeTransportMode,
  resolveTransportModeFromShipmentType,
} from '../domain/shipment-v2/status-mapping'
import type { PaginationParams } from '../types'
import {
  OrderStatus,
  PricingSource,
  ShipmentStatusV2,
  TransportMode,
} from '../types/enums'

const ORDER_STATUS_TITLES: Record<string, string> = {
  pending:           'Order Received',
  picked_up:         'Order Picked Up',
  in_transit:        'Shipment In Transit',
  out_for_delivery:  'Out for Delivery',
  delivered:         'Order Delivered',
  cancelled:         'Order Cancelled',
  returned:          'Order Returned',
}

const ORDER_STATUS_BODIES: Record<string, (tracking: string) => string> = {
  pending:           (t) => `Your order ${t} has been received and is being processed.`,
  picked_up:         (t) => `Your package ${t} has been picked up and is on its way to the warehouse.`,
  in_transit:        (t) => `Your shipment ${t} is now in transit to its destination.`,
  out_for_delivery:  (t) => `Your package ${t} is out for delivery and should arrive soon.`,
  delivered:         (t) => `Your order ${t} has been delivered successfully.`,
  cancelled:         (t) => `Your order ${t} has been cancelled.`,
  returned:          (t) => `Your order ${t} has been returned to sender.`,
}

export interface CreateOrderInput {
  senderId: string
  recipientName: string
  recipientAddress: string
  recipientPhone: string
  recipientEmail?: string
  origin: string
  destination: string
  orderDirection?: 'outbound' | 'inbound'
  weight?: string
  declaredValue?: string
  description?: string
  shipmentType?: 'air' | 'ocean' | 'road'
  priority?: 'standard' | 'express' | 'economy'
  departureDate?: Date | null
  eta?: Date | null
  createdBy: string
}

export interface UpdateOrderStatusInput {
  status: OrderStatus
  updatedBy: string
  // For notification purposes
  senderEmail?: string
  senderPhone?: string
  notifyEmailAlerts?: boolean
  notifySmsAlerts?: boolean
  notifyInAppAlerts?: boolean
}

export interface WarehouseVerifyPackageInput {
  description?: string
  itemType?: string
  quantity?: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  weightKg?: number
  cbm?: number
  isRestricted?: boolean
  restrictedReason?: string
  restrictedOverrideApproved?: boolean
  restrictedOverrideReason?: string
}

export interface VerifyOrderAtWarehouseInput {
  verifiedBy: string
  transportMode?: TransportMode
  packages: WarehouseVerifyPackageInput[]
  manualFinalChargeUsd?: number
  manualAdjustmentReason?: string
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

export class OrdersService {
  async createOrder(input: CreateOrderInput) {
    const trackingNumber = generateTrackingNumber()
    const inferredTransportMode = resolveTransportModeFromShipmentType(input.shipmentType)
    const initialStatusV2 = mapLegacyStatusToV2(OrderStatus.PENDING, inferredTransportMode)

    const [order] = await db
      .insert(orders)
      .values({
        trackingNumber,
        senderId: input.senderId,
        recipientName: encrypt(input.recipientName),
        recipientAddress: encrypt(input.recipientAddress),
        recipientPhone: encrypt(input.recipientPhone),
        recipientEmail: input.recipientEmail ? encrypt(input.recipientEmail) : null,
        origin: input.origin,
        destination: input.destination,
        orderDirection: input.orderDirection ?? 'outbound',
        weight: input.weight ?? null,
        declaredValue: input.declaredValue ?? null,
        description: input.description ?? null,
        shipmentType: input.shipmentType ?? null,
        transportMode: inferredTransportMode,
        priority: input.priority ?? null,
        departureDate: input.departureDate ?? null,
        eta: input.eta ?? null,
        statusV2: initialStatusV2,
        customerStatusV2: initialStatusV2,
        createdBy: input.createdBy,
      })
      .returning()

    if (initialStatusV2) {
      orderStatusEventsService
        .record({
          orderId: order.id,
          status: initialStatusV2,
          actorId: input.createdBy,
        })
        .catch((err) => {
          console.error('Failed to write initial order status event', err)
        })
    }

    return this.decryptOrder(order)
  }

  async getOrderById(id: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1)

    return order ? this.decryptOrder(order) : null
  }

  async getOrderByTrackingNumber(trackingNumber: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.trackingNumber, trackingNumber), isNull(orders.deletedAt)))
      .limit(1)

    return order ? this.decryptOrder(order) : null
  }

  async updateOrderStatus(id: string, input: UpdateOrderStatusInput) {
    const [updated] = await db
      .update(orders)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .returning()

    if (!updated) return null

    const inferredTransportMode =
      updated.transportMode ?? resolveTransportModeFromShipmentType(updated.shipmentType)
    const mappedStatusV2 = mapLegacyStatusToV2(input.status, inferredTransportMode)

    const dualWritePatch: Partial<typeof orders.$inferInsert> = {}
    if (inferredTransportMode && updated.transportMode !== inferredTransportMode) {
      dualWritePatch.transportMode = inferredTransportMode
    }
    if (mappedStatusV2) {
      dualWritePatch.statusV2 = mappedStatusV2
      dualWritePatch.customerStatusV2 = mappedStatusV2
    }
    if (Object.keys(dualWritePatch).length > 0) {
      dualWritePatch.updatedAt = new Date()
      await db
        .update(orders)
        .set(dualWritePatch)
        .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
    }

    if (mappedStatusV2) {
      orderStatusEventsService
        .record({
          orderId: updated.id,
          status: mappedStatusV2,
          actorId: input.updatedBy,
        })
        .catch((err) => {
          console.error('Failed to write order status event', err)
        })
    }

    const decrypted = this.decryptOrder(updated)

    // Push real-time update to the sender
    broadcastToUser(updated.senderId, {
      type: 'order:status_updated',
      data: {
        orderId: updated.id,
        trackingNumber: updated.trackingNumber,
        status: updated.status,
      },
    })

    // Persist in-app notification for the sender (fire-and-forget)
    if (input.notifyInAppAlerts ?? true) {
      notifyUser({
        userId: updated.senderId,
        orderId: updated.id,
        type: 'order_status_update',
        title: ORDER_STATUS_TITLES[input.status] ?? 'Order Updated',
        subtitle: decrypted.trackingNumber,
        body: (ORDER_STATUS_BODIES[input.status] ?? ((t: string) => `Order ${t} has been updated.`))(decrypted.trackingNumber),
        metadata: { orderId: updated.id, trackingNumber: updated.trackingNumber, status: input.status },
      })
    }

    // Send notifications (fire-and-forget — don't let notification failures block the response)
    if (input.senderEmail && (input.notifyEmailAlerts ?? true)) {
      sendOrderStatusUpdateEmail({
        to: input.senderEmail,
        recipientName: decrypted.recipientName,
        trackingNumber: decrypted.trackingNumber,
        status: input.status,
      }).catch((err) => {
        console.error('Failed to send status update email', err)
      })
    }

    if (input.senderPhone && (input.notifySmsAlerts ?? true)) {
      sendOrderStatusWhatsApp({
        phone: input.senderPhone,
        recipientName: decrypted.recipientName,
        trackingNumber: decrypted.trackingNumber,
        status: input.status,
      }).catch((err) => {
        console.error('Failed to send WhatsApp status update', err)
      })
    }

    return decrypted
  }

  async verifyOrderAtWarehouse(id: string, input: VerifyOrderAtWarehouseInput) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1)

    if (!existing) return null

    const rawMode =
      input.transportMode ??
      existing.transportMode ??
      resolveTransportModeFromShipmentType(existing.shipmentType)
    const resolvedMode = normalizeTransportMode(rawMode)

    if (!resolvedMode) {
      throw new Error(
        'Transport mode is required. Provide transportMode or set shipmentType to air/ocean.',
      )
    }

    if (input.packages.length === 0) {
      throw new Error('At least one package is required for warehouse verification.')
    }

    const normalizedPackages = input.packages.map((pkg) => {
      const derivedCbm =
        pkg.cbm ??
        (pkg.lengthCm && pkg.widthCm && pkg.heightCm
          ? roundTo((pkg.lengthCm * pkg.widthCm * pkg.heightCm) / 1_000_000, 6)
          : undefined)

      return {
        description: pkg.description ?? null,
        itemType: pkg.itemType ?? null,
        quantity: pkg.quantity ?? 1,
        lengthCm: pkg.lengthCm ?? null,
        widthCm: pkg.widthCm ?? null,
        heightCm: pkg.heightCm ?? null,
        weightKg: pkg.weightKg ?? null,
        cbm: derivedCbm ?? null,
        isRestricted: pkg.isRestricted ?? false,
        restrictedReason: pkg.restrictedReason ?? null,
        restrictedOverrideApproved: pkg.restrictedOverrideApproved ?? false,
        restrictedOverrideReason: pkg.restrictedOverrideReason ?? null,
      }
    })

    const invalidQuantity = normalizedPackages.some(
      (pkg) => !Number.isInteger(pkg.quantity) || pkg.quantity <= 0,
    )
    if (invalidQuantity) {
      throw new Error('Package quantity must be a positive integer.')
    }

    const hasInvalidRestrictedOverride = normalizedPackages.some(
      (pkg) =>
        pkg.restrictedOverrideApproved &&
        !pkg.restrictedOverrideReason?.trim(),
    )
    if (hasInvalidRestrictedOverride) {
      throw new Error(
        'restrictedOverrideReason is required when restrictedOverrideApproved is true.',
      )
    }

    const totalWeightKg = roundTo(
      normalizedPackages.reduce((sum, pkg) => sum + (pkg.weightKg ?? 0), 0),
      3,
    )

    const totalCbm = roundTo(
      normalizedPackages.reduce((sum, pkg) => sum + (pkg.cbm ?? 0), 6),
      6,
    )

    const fallbackWeight =
      existing.weight !== null && Number(existing.weight) > 0
        ? Number(existing.weight)
        : undefined

    const billableWeightKg = totalWeightKg > 0 ? totalWeightKg : fallbackWeight

    if (resolvedMode === TransportMode.AIR && (!billableWeightKg || billableWeightKg <= 0)) {
      throw new Error(
        'Air verification requires positive weight (package weightKg or order weight).',
      )
    }

    if (resolvedMode === TransportMode.SEA && totalCbm <= 0) {
      throw new Error('Sea verification requires positive cbm (direct or derived from dimensions).')
    }

    const pricing = await pricingV2Service.calculatePricing({
      customerId: existing.senderId,
      mode: resolvedMode,
      weightKg: resolvedMode === TransportMode.AIR ? billableWeightKg : undefined,
      cbm: resolvedMode === TransportMode.SEA ? totalCbm : undefined,
    })

    const hasManualFinalCharge = input.manualFinalChargeUsd !== undefined
    if (hasManualFinalCharge && !input.manualAdjustmentReason?.trim()) {
      throw new Error('manualAdjustmentReason is required when manualFinalChargeUsd is provided.')
    }

    const finalChargeUsd = hasManualFinalCharge
      ? input.manualFinalChargeUsd!
      : pricing.amountUsd

    if (finalChargeUsd <= 0) {
      throw new Error('Final charge must be greater than zero.')
    }

    const pricingSource = hasManualFinalCharge
      ? PricingSource.MANUAL_ADJUSTMENT
      : pricing.pricingSource
    const statusV2 = ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED

    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          transportMode: resolvedMode,
          statusV2,
          customerStatusV2: statusV2,
          priceCalculatedAt: new Date(),
          priceCalculatedBy: input.verifiedBy,
          calculatedChargeUsd: pricing.amountUsd.toString(),
          finalChargeUsd: finalChargeUsd.toString(),
          pricingSource,
          priceAdjustmentReason: input.manualAdjustmentReason?.trim() ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, id), isNull(orders.deletedAt)))

      await tx.delete(orderPackages).where(eq(orderPackages.orderId, id))

      await tx.insert(orderPackages).values(
        normalizedPackages.map((pkg) => ({
          orderId: id,
          description: pkg.description,
          itemType: pkg.itemType,
          quantity: pkg.quantity,
          lengthCm: pkg.lengthCm !== null ? pkg.lengthCm.toString() : null,
          widthCm: pkg.widthCm !== null ? pkg.widthCm.toString() : null,
          heightCm: pkg.heightCm !== null ? pkg.heightCm.toString() : null,
          weightKg: pkg.weightKg !== null ? pkg.weightKg.toString() : null,
          cbm: pkg.cbm !== null ? pkg.cbm.toString() : null,
          isRestricted: pkg.isRestricted,
          restrictedReason: pkg.restrictedReason,
          restrictedOverrideApproved: pkg.restrictedOverrideApproved,
          restrictedOverrideReason: pkg.restrictedOverrideReason,
          restrictedOverrideBy: pkg.restrictedOverrideApproved ? input.verifiedBy : null,
          createdBy: input.verifiedBy,
          updatedBy: input.verifiedBy,
        })),
      )
    })

    orderStatusEventsService
      .record({
        orderId: id,
        status: statusV2,
        actorId: input.verifiedBy,
      })
      .catch((err) => {
        console.error('Failed to write warehouse verification status event', err)
      })

    return this.getOrderById(id)
  }

  async listOrders(
    params: PaginationParams & {
      status?: OrderStatus
      senderId?: string
    },
  ) {
    const offset = getPaginationOffset(params.page, params.limit)

    const conditions = [
      isNull(orders.deletedAt),
      params.status ? eq(orders.status, params.status) : undefined,
      params.senderId ? eq(orders.senderId, params.senderId) : undefined,
    ].filter(Boolean)

    const baseWhere = and(...(conditions as NonNullable<(typeof conditions)[0]>[]))

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(baseWhere)
        .orderBy(desc(orders.createdAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(baseWhere),
    ])

    const total = countResult[0]?.count ?? 0
    return buildPaginatedResult(
      data.map((o) => this.decryptOrder(o)),
      total,
      params,
    )
  }

  /**
   * Unified customer shipments view — combines solo orders + bulk items for a user.
   * Customers see everything in one list without knowing which is solo vs bulk.
   */
  async getMyShipments(userId: string, params: PaginationParams) {
    // Fetch all solo orders and bulk items for the user in parallel
    const [soloOrders, userBulkItems] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(and(eq(orders.senderId, userId), isNull(orders.deletedAt)))
        .orderBy(desc(orders.createdAt)),
      db
        .select({
          id: bulkShipmentItems.id,
          trackingNumber: bulkShipmentItems.trackingNumber,
          status: bulkShipmentItems.status,
          recipientName: bulkShipmentItems.recipientName,
          recipientAddress: bulkShipmentItems.recipientAddress,
          recipientPhone: bulkShipmentItems.recipientPhone,
          recipientEmail: bulkShipmentItems.recipientEmail,
          weight: bulkShipmentItems.weight,
          declaredValue: bulkShipmentItems.declaredValue,
          description: bulkShipmentItems.description,
          createdAt: bulkShipmentItems.createdAt,
          updatedAt: bulkShipmentItems.updatedAt,
          origin: bulkShipments.origin,
          destination: bulkShipments.destination,
        })
        .from(bulkShipmentItems)
        .innerJoin(bulkShipments, eq(bulkShipmentItems.bulkShipmentId, bulkShipments.id))
        .where(
          and(eq(bulkShipmentItems.customerId, userId), isNull(bulkShipments.deletedAt)),
        )
        .orderBy(desc(bulkShipmentItems.createdAt)),
    ])

    const normalizedSolo = soloOrders.map((o) => ({
      type: 'solo' as const,
      id: o.id,
      trackingNumber: o.trackingNumber,
      origin: o.origin,
      destination: o.destination,
      status: o.status,
      orderDirection: o.orderDirection as string,
      recipientName: decrypt(o.recipientName),
      recipientAddress: decrypt(o.recipientAddress),
      recipientPhone: decrypt(o.recipientPhone),
      recipientEmail: o.recipientEmail ? decrypt(o.recipientEmail) : null,
      weight: o.weight,
      declaredValue: o.declaredValue,
      description: o.description,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }))

    const normalizedBulk = userBulkItems.map((item) => ({
      type: 'bulk_item' as const,
      id: item.id,
      trackingNumber: item.trackingNumber,
      origin: item.origin,
      destination: item.destination,
      status: item.status,
      orderDirection: null as string | null,
      recipientName: decrypt(item.recipientName),
      recipientAddress: decrypt(item.recipientAddress),
      recipientPhone: decrypt(item.recipientPhone),
      recipientEmail: item.recipientEmail ? decrypt(item.recipientEmail) : null,
      weight: item.weight,
      declaredValue: item.declaredValue,
      description: item.description,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }))

    // Combine and sort by createdAt descending
    const combined = [...normalizedSolo, ...normalizedBulk].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )

    const total = combined.length
    const offset = getPaginationOffset(params.page, params.limit)
    const data = combined.slice(offset, offset + params.limit)

    return buildPaginatedResult(data, total, params)
  }

  async softDeleteOrder(id: string) {
    const [deleted] = await db
      .update(orders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .returning({ id: orders.id })

    return deleted ?? null
  }

  async getOrderImages(orderId: string) {
    return db
      .select()
      .from(packageImages)
      .where(eq(packageImages.orderId, orderId))
      .orderBy(packageImages.createdAt)
  }

  private decryptOrder(order: typeof orders.$inferSelect) {
    return {
      ...order,
      recipientName: decrypt(order.recipientName),
      recipientAddress: decrypt(order.recipientAddress),
      recipientPhone: decrypt(order.recipientPhone),
      recipientEmail: order.recipientEmail ? decrypt(order.recipientEmail) : null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      deletedAt: order.deletedAt?.toISOString() ?? null,
      departureDate: order.departureDate?.toISOString() ?? null,
      eta: order.eta?.toISOString() ?? null,
    }
  }
}

export const ordersService = new OrdersService()
