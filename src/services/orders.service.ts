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
import { settingsTemplatesService } from './settings-templates.service'
import {
  normalizeTransportMode,
  resolveTransportModeFromShipmentType,
} from '../domain/shipment-v2/status-mapping'
import {
  canTransitionSequentially,
  isExceptionStatus,
  COMMON_FLOW,
} from '../domain/shipment-v2/status-transitions'
import type { PaginationParams } from '../types'
import {
  PricingSource,
  ShipmentStatusV2,
  TransportMode,
} from '../types/enums'

// Statuses that trigger customer-facing notifications
const MILESTONE_STATUSES = new Set<ShipmentStatusV2>([
  ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
  ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT,
  ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT,
  ShipmentStatusV2.FLIGHT_DEPARTED,
  ShipmentStatusV2.VESSEL_DEPARTED,
  ShipmentStatusV2.FLIGHT_LANDED_LAGOS,
  ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT,
  ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS,
  ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE,
  ShipmentStatusV2.READY_FOR_PICKUP,
  ShipmentStatusV2.PICKED_UP_COMPLETED,
  ShipmentStatusV2.ON_HOLD,
  ShipmentStatusV2.CANCELLED,
  ShipmentStatusV2.RESTRICTED_ITEM_REJECTED,
  ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED,
])

const V2_MILESTONE_TITLES: Partial<Record<ShipmentStatusV2, string>> = {
  [ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED]: 'Package Verified & Priced',
  [ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT]: 'Dispatched to Airport',
  [ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT]: 'Dispatched to Port',
  [ShipmentStatusV2.FLIGHT_DEPARTED]: 'Flight Departed',
  [ShipmentStatusV2.VESSEL_DEPARTED]: 'Vessel Departed',
  [ShipmentStatusV2.FLIGHT_LANDED_LAGOS]: 'Landed in Lagos',
  [ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT]: 'Arrived at Lagos Port',
  [ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS]: 'Customs Cleared',
  [ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE]: 'In Transit to Office',
  [ShipmentStatusV2.READY_FOR_PICKUP]: 'Ready for Pickup',
  [ShipmentStatusV2.PICKED_UP_COMPLETED]: 'Pickup Completed',
  [ShipmentStatusV2.ON_HOLD]: 'Shipment On Hold',
  [ShipmentStatusV2.CANCELLED]: 'Shipment Cancelled',
  [ShipmentStatusV2.RESTRICTED_ITEM_REJECTED]: 'Item Rejected — Restricted',
  [ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED]: 'Restricted Item Override Approved',
}

const V2_MILESTONE_BODIES: Partial<Record<ShipmentStatusV2, (tracking: string) => string>> = {
  [ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED]: (t) => `Your package ${t} has been verified at the warehouse and priced.`,
  [ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT]: (t) => `Your shipment ${t} has been dispatched to the origin airport.`,
  [ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT]: (t) => `Your shipment ${t} has been dispatched to the origin port.`,
  [ShipmentStatusV2.FLIGHT_DEPARTED]: (t) => `Your shipment ${t} is on its way — the flight has departed.`,
  [ShipmentStatusV2.VESSEL_DEPARTED]: (t) => `Your shipment ${t} is on its way — the vessel has departed.`,
  [ShipmentStatusV2.FLIGHT_LANDED_LAGOS]: (t) => `Your shipment ${t} has landed in Lagos.`,
  [ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT]: (t) => `Your shipment ${t} has arrived at Lagos port.`,
  [ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS]: (t) => `Your shipment ${t} has cleared customs in Lagos.`,
  [ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE]: (t) => `Your package ${t} is in transit to our Lagos office.`,
  [ShipmentStatusV2.READY_FOR_PICKUP]: (t) => `Your package ${t} is ready for pickup at our Lagos office.`,
  [ShipmentStatusV2.PICKED_UP_COMPLETED]: (t) => `Your package ${t} has been picked up. Thank you!`,
  [ShipmentStatusV2.ON_HOLD]: (t) => `Your shipment ${t} has been placed on hold. Please contact us for more details.`,
  [ShipmentStatusV2.CANCELLED]: (t) => `Your shipment ${t} has been cancelled.`,
  [ShipmentStatusV2.RESTRICTED_ITEM_REJECTED]: (t) => `Your shipment ${t} contains a restricted item and has been rejected.`,
  [ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED]: (t) => `The restricted item in your shipment ${t} has been approved with an override.`,
}

// Active lane is fixed for this release
const ORIGIN = 'South Korea'
const DESTINATION = 'Lagos, Nigeria'

export interface CreateOrderInput {
  senderId: string
  recipientName: string
  recipientAddress: string
  recipientPhone: string
  recipientEmail?: string
  orderDirection?: 'outbound' | 'inbound'
  weight?: string
  declaredValue?: string
  description?: string
  shipmentType?: 'air' | 'ocean'
  departureDate?: Date | null
  eta?: Date | null
  isPreorder?: boolean
  createdBy: string
  pickupRepName?: string
  pickupRepPhone?: string
}

export interface UpdateOrderStatusInput {
  statusV2: ShipmentStatusV2
  updatedBy: string
  // For notification purposes
  senderEmail?: string
  senderPhone?: string
  notifyEmailAlerts?: boolean
  notifySmsAlerts?: boolean
  notifyInAppAlerts?: boolean
  preferredLanguage?: string
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
    // Pre-orders (customer self-created) start at PREORDER_SUBMITTED; staff-created start at AWAITING_WAREHOUSE_RECEIPT
    const initialStatusV2 = input.isPreorder
      ? ShipmentStatusV2.PREORDER_SUBMITTED
      : ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT

    const [order] = await db
      .insert(orders)
      .values({
        trackingNumber,
        senderId: input.senderId,
        recipientName: encrypt(input.recipientName),
        recipientAddress: encrypt(input.recipientAddress),
        recipientPhone: encrypt(input.recipientPhone),
        recipientEmail: input.recipientEmail ? encrypt(input.recipientEmail) : null,
        origin: ORIGIN,
        destination: DESTINATION,
        orderDirection: input.orderDirection ?? 'outbound',
        weight: input.weight ?? null,
        declaredValue: input.declaredValue ?? null,
        description: input.description ?? null,
        shipmentType: input.shipmentType ?? null,
        transportMode: inferredTransportMode,
        isPreorder: input.isPreorder ?? false,
        departureDate: input.departureDate ?? null,
        eta: input.eta ?? null,
        statusV2: initialStatusV2,
        customerStatusV2: initialStatusV2,
        createdBy: input.createdBy,
        pickupRepName: input.pickupRepName ? encrypt(input.pickupRepName) : null,
        pickupRepPhone: input.pickupRepPhone ? encrypt(input.pickupRepPhone) : null,
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

    // Notify the customer when staff create a shipment on their behalf
    if (!input.isPreorder) {
      notifyUser({
        userId: input.senderId,
        orderId: order.id,
        type: 'order_status_update',
        title: 'New shipment created',
        subtitle: trackingNumber,
        body: 'A new shipment has been created for you. We will update you as it progresses.',
        createdBy: input.createdBy,
      }).catch(() => {})
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
    // 1. Fetch order to validate the current state before writing
    const [existing] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1)

    if (!existing) return null

    // 2. Resolve transport mode (set after warehouse verification)
    const mode = normalizeTransportMode(
      existing.transportMode ?? resolveTransportModeFromShipmentType(existing.shipmentType),
    )

    // 3. Enforce sequential transition rules
    if (mode) {
      if (!canTransitionSequentially(mode, existing.statusV2 as ShipmentStatusV2 | null, input.statusV2)) {
        throw new Error(
          `Invalid status transition: cannot move from "${existing.statusV2 ?? 'none'}" to "${input.statusV2}" for ${mode} shipments.`,
        )
      }
    } else {
      // No transport mode yet — only common flow statuses and exceptions are allowed
      if (!isExceptionStatus(input.statusV2) && !COMMON_FLOW.includes(input.statusV2)) {
        throw new Error(
          `Transport mode must be set via warehouse verification before advancing to "${input.statusV2}".`,
        )
      }
      // Validate sequential order within the common flow (use AIR as placeholder — both flows share COMMON_FLOW)
      if (!isExceptionStatus(input.statusV2) && !canTransitionSequentially(TransportMode.AIR, existing.statusV2 as ShipmentStatusV2 | null, input.statusV2)) {
        throw new Error(
          `Invalid status transition: cannot move from "${existing.statusV2 ?? 'none'}" to "${input.statusV2}".`,
        )
      }
    }

    // 4. Payment gate — order must be paid before it can be marked ready for pickup
    if (input.statusV2 === ShipmentStatusV2.READY_FOR_PICKUP) {
      if (existing.paymentCollectionStatus !== 'PAID_IN_FULL') {
        throw new Error(
          'Payment must be collected in full before marking the shipment as ready for pickup.',
        )
      }
    }

    // 5. Write statusV2 as primary (legacy status column no longer synced — Phase 6)
    const [updated] = await db
      .update(orders)
      .set({
        statusV2: input.statusV2,
        customerStatusV2: input.statusV2,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .returning()

    if (!updated) return null

    // 7. Record status event (fire-and-forget)
    orderStatusEventsService
      .record({
        orderId: updated.id,
        status: input.statusV2,
        actorId: input.updatedBy,
      })
      .catch((err) => {
        console.error('Failed to write order status event', err)
      })

    const decrypted = this.decryptOrder(updated)

    // 8. Push real-time update to the sender
    broadcastToUser(updated.senderId, {
      type: 'order_status_updated',
      data: {
        orderId: updated.id,
        trackingNumber: updated.trackingNumber,
        statusV2: updated.statusV2,
        updatedAt: updated.updatedAt,
      },
    })

    // 9. Milestone-only customer notifications (fire-and-forget)
    if (MILESTONE_STATUSES.has(input.statusV2)) {
      const templateKey = `order.${input.statusV2.toLowerCase()}`
      const locale = (input.preferredLanguage ?? 'en') as import('../types/enums').PreferredLanguage

      // Hardcoded fallbacks (used when no DB template is found)
      const fallbackTitle = V2_MILESTONE_TITLES[input.statusV2] ?? 'Shipment Updated'
      const fallbackBody = (V2_MILESTONE_BODIES[input.statusV2] ?? ((t: string) => `Your shipment ${t} has been updated.`))(decrypted.trackingNumber)

      if (input.notifyInAppAlerts ?? true) {
        // Look up in-app template; fall back to hardcoded title/body
        settingsTemplatesService
          .getTemplate(templateKey, locale, 'in_app')
          .then((tmpl) => {
            const vars: Record<string, string> = {
              trackingNumber: decrypted.trackingNumber,
              recipientName: decrypted.recipientName,
            }
            const render = (s: string) =>
              s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)
            notifyUser({
              userId: updated.senderId,
              orderId: updated.id,
              type: 'order_status_update',
              title: tmpl ? render(tmpl.subject ?? fallbackTitle) : fallbackTitle,
              subtitle: decrypted.trackingNumber,
              body: tmpl ? render(tmpl.body) : fallbackBody,
              metadata: { orderId: updated.id, trackingNumber: updated.trackingNumber, statusV2: input.statusV2 },
            })
          })
          .catch((err) => {
            console.error('Failed to look up in-app template, using fallback', err)
            notifyUser({
              userId: updated.senderId,
              orderId: updated.id,
              type: 'order_status_update',
              title: fallbackTitle,
              subtitle: decrypted.trackingNumber,
              body: fallbackBody,
              metadata: { orderId: updated.id, trackingNumber: updated.trackingNumber, statusV2: input.statusV2 },
            })
          })
      }

      if (input.senderEmail && (input.notifyEmailAlerts ?? true)) {
        sendOrderStatusUpdateEmail({
          to: input.senderEmail,
          recipientName: decrypted.recipientName,
          trackingNumber: decrypted.trackingNumber,
          status: input.statusV2,
          templateKey,
          locale,
        }).catch((err) => {
          console.error('Failed to send status update email', err)
        })
      }

      if (input.senderPhone && (input.notifySmsAlerts ?? true)) {
        sendOrderStatusWhatsApp({
          phone: input.senderPhone,
          recipientName: decrypted.recipientName,
          trackingNumber: decrypted.trackingNumber,
          status: input.statusV2,
        }).catch((err) => {
          console.error('Failed to send WhatsApp status update', err)
        })
      }
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
      statusV2?: ShipmentStatusV2
      senderId?: string
    },
  ) {
    const offset = getPaginationOffset(params.page, params.limit)

    const conditions = [
      isNull(orders.deletedAt),
      params.statusV2 ? eq(orders.statusV2, params.statusV2) : undefined,
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
          statusV2: bulkShipmentItems.statusV2,
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
      statusV2: o.statusV2,
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
      statusV2: item.statusV2,
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

  async updatePickupRep(orderId: string, input: { pickupRepName: string; pickupRepPhone: string }) {
    const [updated] = await db
      .update(orders)
      .set({
        pickupRepName: encrypt(input.pickupRepName),
        pickupRepPhone: encrypt(input.pickupRepPhone),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .returning()

    return updated ? this.decryptOrder(updated) : null
  }

  private decryptOrder(order: typeof orders.$inferSelect) {
    // amountDue = finalChargeUsd when payment not yet collected, null when paid or not yet priced
    const amountDue =
      order.paymentCollectionStatus !== 'PAID_IN_FULL' && order.finalChargeUsd !== null
        ? order.finalChargeUsd
        : null

    return {
      ...order,
      recipientName: decrypt(order.recipientName),
      recipientAddress: decrypt(order.recipientAddress),
      recipientPhone: decrypt(order.recipientPhone),
      recipientEmail: order.recipientEmail ? decrypt(order.recipientEmail) : null,
      pickupRepName: order.pickupRepName ? decrypt(order.pickupRepName) : null,
      pickupRepPhone: order.pickupRepPhone ? decrypt(order.pickupRepPhone) : null,
      amountDue,
      priceCalculatedAt: order.priceCalculatedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      deletedAt: order.deletedAt?.toISOString() ?? null,
      departureDate: order.departureDate?.toISOString() ?? null,
      eta: order.eta?.toISOString() ?? null,
    }
  }
}

export const ordersService = new OrdersService()
