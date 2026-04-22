import { eq, and, isNull, sql, desc } from 'drizzle-orm'
import { db } from '../config/db'
import {
  orders,
  packageImages,
  orderPackages,
  invoices,
  shipmentMeasurements,
  users,
} from '../../drizzle/schema'
import { appSettings } from '../../drizzle/schema/app-settings'
import { encrypt, decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { generateTrackingNumber } from '../utils/tracking'
import { broadcastToUser } from '../websocket/handlers'
import { sendOrderStatusUpdateEmail } from '../notifications/email'
import { sendOrderStatusWhatsApp } from '../notifications/whatsapp'
import { notifyUser } from './notifications.service'
import { orderStatusEventsService } from './order-status-events.service'
import { pricingV2Service, SEA_CBM_TO_KG_FACTOR } from './pricing-v2.service'
import { settingsTemplatesService } from './settings-templates.service'
import { dispatchBatchesService } from './dispatch-batches.service'
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
  ShipmentPayer,
  ShipmentStatusV2,
  ShipmentType,
  TransportMode,
  UserRole,
} from '../types/enums'

/** Compute ETA from departure date + shipment lane transit days */
function computeEta(
  departureDate: Date | null,
  shipmentType: string | null,
  transportMode?: string | null,
): string | null {
  if (!departureDate) return null
  const transitDays = shipmentType === 'ocean' || transportMode === TransportMode.SEA ? 90 : 7
  const eta = new Date(departureDate)
  eta.setDate(eta.getDate() + transitDays)
  return eta.toISOString()
}

// Statuses that trigger customer-facing notifications
const MILESTONE_STATUSES = new Set<ShipmentStatusV2>([
  ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
  ShipmentStatusV2.FLIGHT_DEPARTED,
  ShipmentStatusV2.VESSEL_DEPARTED,
  ShipmentStatusV2.FLIGHT_LANDED_LAGOS,
  ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT,
  ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS,
  ShipmentStatusV2.IN_EXTRA_TRUCK_MOVEMENT_LAGOS,
  ShipmentStatusV2.LOCAL_COURIER_ASSIGNED,
  ShipmentStatusV2.OUT_FOR_DELIVERY_DESTINATION_CITY,
  ShipmentStatusV2.DELIVERED_TO_RECIPIENT,
  ShipmentStatusV2.READY_FOR_PICKUP,
  ShipmentStatusV2.ON_HOLD,
  ShipmentStatusV2.CANCELLED,
  ShipmentStatusV2.RESTRICTED_ITEM_REJECTED,
])

const V2_MILESTONE_TITLES: Partial<Record<ShipmentStatusV2, string>> = {
  [ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED]: 'Package Verified & Priced',
  [ShipmentStatusV2.FLIGHT_DEPARTED]: 'Flight Departed',
  [ShipmentStatusV2.VESSEL_DEPARTED]: 'Vessel Departed',
  [ShipmentStatusV2.FLIGHT_LANDED_LAGOS]: 'Landed in Lagos',
  [ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT]: 'Arrived at Lagos Port',
  [ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS]: 'Customs Cleared',
  [ShipmentStatusV2.IN_EXTRA_TRUCK_MOVEMENT_LAGOS]: 'Extra Truck Movement in Lagos',
  [ShipmentStatusV2.LOCAL_COURIER_ASSIGNED]: 'Local Courier Assigned',
  [ShipmentStatusV2.OUT_FOR_DELIVERY_DESTINATION_CITY]: 'Out for Delivery',
  [ShipmentStatusV2.DELIVERED_TO_RECIPIENT]: 'Delivered to Recipient',
  [ShipmentStatusV2.READY_FOR_PICKUP]: 'Ready for Pickup',
  [ShipmentStatusV2.ON_HOLD]: 'Shipment On Hold',
  [ShipmentStatusV2.CANCELLED]: 'Shipment Cancelled',
  [ShipmentStatusV2.RESTRICTED_ITEM_REJECTED]: 'Item Rejected — Restricted',
}

const V2_MILESTONE_BODIES: Partial<Record<ShipmentStatusV2, (tracking: string) => string>> = {
  [ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED]: (t) => `Your package ${t} has been verified at the warehouse and priced.`,
  [ShipmentStatusV2.FLIGHT_DEPARTED]: (t) => `Your shipment ${t} is on its way — the flight has departed.`,
  [ShipmentStatusV2.VESSEL_DEPARTED]: (t) => `Your shipment ${t} is on its way — the vessel has departed.`,
  [ShipmentStatusV2.FLIGHT_LANDED_LAGOS]: (t) => `Your shipment ${t} has landed in Lagos.`,
  [ShipmentStatusV2.VESSEL_ARRIVED_LAGOS_PORT]: (t) => `Your shipment ${t} has arrived at Lagos port.`,
  [ShipmentStatusV2.CUSTOMS_CLEARED_LAGOS]: (t) => `Your shipment ${t} has cleared customs in Lagos.`,
  [ShipmentStatusV2.IN_EXTRA_TRUCK_MOVEMENT_LAGOS]: (t) => `Your shipment ${t} is on an extra truck movement leg in Lagos.`,
  [ShipmentStatusV2.LOCAL_COURIER_ASSIGNED]: (t) => `Your shipment ${t} has been handed over to a local courier.`,
  [ShipmentStatusV2.OUT_FOR_DELIVERY_DESTINATION_CITY]: (t) => `Your shipment ${t} is out for delivery in your destination city.`,
  [ShipmentStatusV2.DELIVERED_TO_RECIPIENT]: (t) => `Your shipment ${t} has been delivered.`,
  [ShipmentStatusV2.READY_FOR_PICKUP]: (t) => `Your package ${t} is ready for pickup at our Lagos office.`,
  [ShipmentStatusV2.ON_HOLD]: (t) => `Your shipment ${t} has been placed on hold. Please contact us for more details.`,
  [ShipmentStatusV2.CANCELLED]: (t) => `Your shipment ${t} has been cancelled.`,
  [ShipmentStatusV2.RESTRICTED_ITEM_REJECTED]: (t) => `Your shipment ${t} contains a restricted item and has been rejected.`,
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
  shipmentType?: 'air' | 'ocean' | 'd2d'
  shipmentPayer?: ShipmentPayer
  billingSupplierId?: string | null
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
  actorRole: UserRole
  // For notification purposes
  senderEmail?: string
  senderPhone?: string
  notifyEmailAlerts?: boolean
  notifySmsAlerts?: boolean
  notifyInAppAlerts?: boolean
  preferredLanguage?: string
}

export interface WarehouseVerifyPackageInput {
  supplierId?: string
  arrivalAt?: Date
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
  specialPackagingType?: string
  isRestricted?: boolean
  restrictedReason?: string
  restrictedOverrideApproved?: boolean
  restrictedOverrideReason?: string
}

export interface VerifyOrderAtWarehouseInput {
  verifiedBy: string
  transportMode?: TransportMode
  departureDate?: Date
  packages: WarehouseVerifyPackageInput[]
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

const AIR_VOLUMETRIC_DIVISOR = 6000

function isExternalViewerRole(role: UserRole): boolean {
  return role === UserRole.USER || role === UserRole.SUPPLIER
}

export class OrdersService {
  async createOrder(input: CreateOrderInput) {
    const trackingNumber = generateTrackingNumber()
    const inferredTransportMode = resolveTransportModeFromShipmentType(input.shipmentType)
    const shouldAttachToBatch = Boolean(inferredTransportMode) && !(input.isPreorder ?? false)
    const dispatchBatchId = shouldAttachToBatch
      ? (await dispatchBatchesService.getOrCreateOpenBatch(inferredTransportMode!, input.createdBy)).id
      : null

    if (shouldAttachToBatch && dispatchBatchId && inferredTransportMode) {
      const [existingInBatch] = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.senderId, input.senderId),
            eq(orders.dispatchBatchId, dispatchBatchId),
            eq(orders.transportMode, inferredTransportMode),
            isNull(orders.deletedAt),
          ),
        )
        .orderBy(desc(orders.createdAt))
        .limit(1)

      if (existingInBatch) {
        await dispatchBatchesService.ensureDraftInvoiceForOrder({
          orderId: existingInBatch.id,
          actorId: input.createdBy,
          totalUsd: Number(existingInBatch.finalChargeUsd ?? existingInBatch.calculatedChargeUsd ?? 0),
        })
        return this.decryptOrder(existingInBatch)
      }
    }
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
        weight: input.weight ? String(parseFloat(input.weight.replace(/[^0-9.]/g, '')) || 0) : null,
        declaredValue: input.declaredValue ? String(parseFloat(input.declaredValue.replace(/[^0-9.]/g, '')) || 0) : null,
        description: input.description ?? null,
        shipmentType: input.shipmentType ?? null,
        shipmentPayer: input.shipmentPayer ?? ShipmentPayer.USER,
        billingSupplierId: input.billingSupplierId ?? null,
        transportMode: inferredTransportMode,
        dispatchBatchId,
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

    await dispatchBatchesService.ensureDraftInvoiceForOrder({
      orderId: order.id,
      actorId: input.createdBy,
      totalUsd: Number(order.finalChargeUsd ?? order.calculatedChargeUsd ?? 0),
    })

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

    const requiresExtraTruckMovement = await this.orderRequiresExtraTruckMovement(id)
    this.assertOrderCanTransition(existing, input.statusV2, { requiresExtraTruckMovement })

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

    await dispatchBatchesService.handleDepartureStatus({
      orderId: updated.id,
      orderBatchId: updated.dispatchBatchId ?? null,
      status: input.statusV2,
      actorId: input.updatedBy,
      actorRole: input.actorRole,
    })

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

    // 9a. Pre-order picked up — notify customer that staff is now processing their order
    if (
      existing.isPreorder &&
      existing.statusV2 === ShipmentStatusV2.PREORDER_SUBMITTED &&
      input.statusV2 === ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT
    ) {
      const title = 'Your Pre-Order Is Being Processed'
      const body = `Your pre-order ${decrypted.trackingNumber} has been picked up by our team and is now being processed.`

      if (input.notifyInAppAlerts ?? true) {
        notifyUser({
          userId: updated.senderId,
          orderId: updated.id,
          type: 'order_status_update',
          title,
          subtitle: decrypted.trackingNumber,
          body,
          metadata: { orderId: updated.id, trackingNumber: updated.trackingNumber, statusV2: input.statusV2 },
        }).catch(() => {})
      }

      if (input.senderEmail && (input.notifyEmailAlerts ?? true)) {
        sendOrderStatusUpdateEmail({
          to: input.senderEmail,
          recipientName: decrypted.recipientName,
          trackingNumber: decrypted.trackingNumber,
          status: input.statusV2,
          templateKey: 'order.preorder_processing',
          locale: (input.preferredLanguage ?? 'en') as import('../types/enums').PreferredLanguage,
        }).catch((err) => {
          console.error('Failed to send pre-order processing email', err)
        })
      }

      if (input.senderPhone && (input.notifySmsAlerts ?? true)) {
        sendOrderStatusWhatsApp({
          phone: input.senderPhone,
          recipientName: decrypted.recipientName,
          trackingNumber: decrypted.trackingNumber,
          status: input.statusV2,
        }).catch((err) => {
          console.error('Failed to send pre-order processing WhatsApp', err)
        })
      }
    }

    // 9b. Milestone-only customer notifications (fire-and-forget)
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

    await this.notifyD2DSuppliersIfNeeded({
      orderId: updated.id,
      trackingNumber: decrypted.trackingNumber,
      statusV2: input.statusV2,
      shipmentType: updated.shipmentType,
      locale: (input.preferredLanguage ?? 'en') as import('../types/enums').PreferredLanguage,
    })

    return decrypted
  }

  async updateBatchStatus(input: {
    batchId: string
    statusV2: ShipmentStatusV2
    updatedBy: string
    actorRole: UserRole
    actorCanManageShipmentBatches: boolean
  }) {
    const rows = await db
      .select({
        orderId: orders.id,
        statusV2: orders.statusV2,
        shipmentType: orders.shipmentType,
        transportMode: orders.transportMode,
        paymentCollectionStatus: orders.paymentCollectionStatus,
        requiresExtraTruckMovement: sql<boolean>`exists(
          select 1
          from order_packages op
          where op.order_id = ${orders.id}
            and op.requires_extra_truck_movement = true
        )`,
        senderEmail: users.email,
        senderPhone: users.phone,
        notifyEmailAlerts: users.notifyEmailAlerts,
        notifySmsAlerts: users.notifySmsAlerts,
        notifyInAppAlerts: users.notifyInAppAlerts,
        preferredLanguage: users.preferredLanguage,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.senderId))
      .where(and(eq(orders.dispatchBatchId, input.batchId), isNull(orders.deletedAt)))

    if (rows.length === 0) {
      throw new Error('No shipments found in this batch.')
    }

    rows.forEach((row) => {
      this.assertOrderCanTransition(
        {
          statusV2: row.statusV2,
          shipmentType: row.shipmentType,
          transportMode: row.transportMode,
          paymentCollectionStatus: row.paymentCollectionStatus,
        } as Pick<
          typeof orders.$inferSelect,
          'statusV2' | 'shipmentType' | 'transportMode' | 'paymentCollectionStatus'
        >,
        input.statusV2,
        { requiresExtraTruckMovement: row.requiresExtraTruckMovement },
      )
    })

    const updatedOrders: Array<{ id: string; trackingNumber: string }> = []

    for (const row of rows) {
      const senderEmail = row.senderEmail ? decrypt(row.senderEmail) : undefined
      const senderPhone = row.senderPhone ? decrypt(row.senderPhone) : undefined

      const updated = await this.updateOrderStatus(row.orderId, {
        statusV2: input.statusV2,
        updatedBy: input.updatedBy,
        actorRole: input.actorRole,
        senderEmail,
        senderPhone,
        notifyEmailAlerts: row.notifyEmailAlerts,
        notifySmsAlerts: row.notifySmsAlerts,
        notifyInAppAlerts: row.notifyInAppAlerts,
        preferredLanguage: row.preferredLanguage,
      })

      if (!updated) continue
      updatedOrders.push({ id: updated.id, trackingNumber: updated.trackingNumber })
    }

    const departedStatuses = new Set<ShipmentStatusV2>([
      ShipmentStatusV2.FLIGHT_DEPARTED,
      ShipmentStatusV2.VESSEL_DEPARTED,
    ])

    if (departedStatuses.has(input.statusV2) && input.actorCanManageShipmentBatches) {
      await dispatchBatchesService.approveCutoff(input.batchId, input.updatedBy)
    }

    return {
      batchId: input.batchId,
      statusV2: input.statusV2,
      updatedCount: updatedOrders.length,
      updatedOrders,
    }
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

    // ── Look up special packaging surcharge types from app_settings ──
    let surchargeMap = new Map<string, number>()
    const packagesHaveSpecialType = input.packages.some((p) => p.specialPackagingType)
    if (packagesHaveSpecialType) {
      const [setting] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'special_packaging_surcharges'))
        .limit(1)
      if (setting?.value) {
        const types = (setting.value as { types?: { key: string; name: string; surchargeUsd: number }[] }).types ?? []
        for (const t of types) surchargeMap.set(t.key, t.surchargeUsd)
      }
    }

    const normalizedPackages = input.packages.map((pkg) => {
      const derivedCbm =
        pkg.cbm ??
        (pkg.lengthCm && pkg.widthCm && pkg.heightCm
          ? roundTo((pkg.lengthCm * pkg.widthCm * pkg.heightCm) / 1_000_000, 6)
          : undefined)

      const derivedAirVolumetricWeightKg =
        pkg.lengthCm && pkg.widthCm && pkg.heightCm
          ? roundTo((pkg.lengthCm * pkg.widthCm * pkg.heightCm) / AIR_VOLUMETRIC_DIVISOR, 3)
          : derivedCbm && derivedCbm > 0
            ? roundTo((derivedCbm * 1_000_000) / AIR_VOLUMETRIC_DIVISOR, 3)
            : null

      // If dimensions are not available, fall back to actual measured weight for air billing.
      const airChargeableWeightKg = roundTo(
        Math.max(pkg.weightKg ?? 0, derivedAirVolumetricWeightKg ?? 0),
        3,
      )

      let specialPackagingSurchargeUsd: number | null = null
      if (pkg.specialPackagingType) {
        const surcharge = surchargeMap.get(pkg.specialPackagingType)
        if (surcharge === undefined) {
          throw new Error(`Unknown special packaging type: "${pkg.specialPackagingType}". Check app settings.`)
        }
        specialPackagingSurchargeUsd = surcharge * (pkg.quantity ?? 1)
      }

      return {
        supplierId: pkg.supplierId ?? null,
        arrivalAt: pkg.arrivalAt ?? new Date(),
        description: pkg.description ?? null,
        itemType: pkg.itemType ?? null,
        quantity: pkg.quantity ?? 1,
        lengthCm: pkg.lengthCm ?? null,
        widthCm: pkg.widthCm ?? null,
        heightCm: pkg.heightCm ?? null,
        weightKg: pkg.weightKg ?? null,
        cbm: derivedCbm ?? null,
        airVolumetricWeightKg: derivedAirVolumetricWeightKg,
        airChargeableWeightKg,
        requiresExtraTruckMovement: pkg.requiresExtraTruckMovement ?? false,
        specialPackagingType: pkg.specialPackagingType ?? null,
        specialPackagingSurchargeUsd,
        itemCostUsd: pkg.itemCostUsd ?? null,
        isRestricted: pkg.isRestricted ?? false,
        restrictedReason: pkg.restrictedReason ?? null,
        restrictedOverrideApproved: pkg.restrictedOverrideApproved ?? false,
        restrictedOverrideReason: pkg.restrictedOverrideReason ?? null,
      }
    })

    if (existing.shipmentType === ShipmentType.D2D) {
      const hasInvalidD2DMeasures = normalizedPackages.some(
        (pkg) => (pkg.weightKg ?? 0) <= 0 || (pkg.cbm ?? 0) <= 0,
      )
      if (hasInvalidD2DMeasures) {
        throw new Error('D2D warehouse verification requires both positive weightKg and cbm for each package.')
      }

      const [imageCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(packageImages)
        .where(eq(packageImages.orderId, id))
      if ((imageCountRow?.count ?? 0) < 1) {
        throw new Error('D2D warehouse verification requires at least one uploaded goods image.')
      }
    }

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

    const totalAirChargeableWeightKg = roundTo(
      normalizedPackages.reduce((sum, pkg) => sum + pkg.airChargeableWeightKg, 0),
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

    const billableAirWeightKg = totalAirChargeableWeightKg > 0
      ? totalAirChargeableWeightKg
      : fallbackWeight

    if (resolvedMode === TransportMode.AIR && (!billableAirWeightKg || billableAirWeightKg <= 0)) {
      throw new Error(
        'Air verification requires positive chargeable weight (actual and/or volumetric from dimensions).',
      )
    }

    if (resolvedMode === TransportMode.SEA && totalCbm <= 0) {
      throw new Error('Sea verification requires positive cbm (direct or derived from dimensions).')
    }

    const seaChargeableWeightKg =
      resolvedMode === TransportMode.SEA
        ? roundTo(totalCbm * SEA_CBM_TO_KG_FACTOR, 3)
        : undefined

    const pricing = await pricingV2Service.calculatePricing({
      customerId: existing.senderId,
      mode: resolvedMode,
      weightKg:
        resolvedMode === TransportMode.AIR
          ? billableAirWeightKg
          : resolvedMode === TransportMode.SEA
            ? seaChargeableWeightKg
            : undefined,
      cbm: resolvedMode === TransportMode.SEA ? totalCbm : undefined,
    })

    const totalSpecialPackagingSurcharge = roundTo(
      normalizedPackages.reduce((sum, pkg) => sum + (pkg.specialPackagingSurchargeUsd ?? 0), 0),
      2,
    )

    const finalChargeUsd = pricing.amountUsd + totalSpecialPackagingSurcharge

    if (finalChargeUsd <= 0) {
      throw new Error('Final charge must be greater than zero.')
    }

    const pricingSource = pricing.pricingSource
    const statusV2 = ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED

    const eta = input.departureDate
      ? new Date(
          input.departureDate.getTime() +
            (resolvedMode === TransportMode.SEA ? 90 : 7) * 24 * 60 * 60 * 1000,
        )
      : null

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
          specialPackagingSurchargeUsd: totalSpecialPackagingSurcharge > 0 ? totalSpecialPackagingSurcharge.toString() : null,
          finalChargeUsd: finalChargeUsd.toString(),
          pricingSource,
          ...(input.departureDate !== undefined && { departureDate: input.departureDate }),
          ...(eta !== null && { eta }),
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, id), isNull(orders.deletedAt)))

      await tx.delete(orderPackages).where(eq(orderPackages.orderId, id))

      await tx.insert(orderPackages).values(
        normalizedPackages.map((pkg) => ({
          orderId: id,
          supplierId: pkg.supplierId,
          arrivalAt: pkg.arrivalAt,
          description: pkg.description,
          itemType: pkg.itemType,
          quantity: pkg.quantity,
          lengthCm: pkg.lengthCm !== null ? pkg.lengthCm.toString() : null,
          widthCm: pkg.widthCm !== null ? pkg.widthCm.toString() : null,
          heightCm: pkg.heightCm !== null ? pkg.heightCm.toString() : null,
          weightKg: pkg.weightKg !== null ? pkg.weightKg.toString() : null,
          cbm: pkg.cbm !== null ? pkg.cbm.toString() : null,
          itemCostUsd: pkg.itemCostUsd !== null ? pkg.itemCostUsd.toString() : null,
          requiresExtraTruckMovement: pkg.requiresExtraTruckMovement,
          specialPackagingType: pkg.specialPackagingType,
          specialPackagingSurchargeUsd: pkg.specialPackagingSurchargeUsd !== null ? pkg.specialPackagingSurchargeUsd.toString() : null,
          isRestricted: pkg.isRestricted,
          restrictedReason: pkg.restrictedReason,
          restrictedOverrideApproved: pkg.restrictedOverrideApproved,
          restrictedOverrideReason: pkg.restrictedOverrideReason,
          restrictedOverrideBy: pkg.restrictedOverrideApproved ? input.verifiedBy : null,
          createdBy: input.verifiedBy,
          updatedBy: input.verifiedBy,
        })),
      )

      const checkpointWeightKg = roundTo(
        normalizedPackages.reduce((sum, pkg) => sum + (pkg.weightKg ?? 0), 0),
        3,
      )
      const checkpointCbm = roundTo(
        normalizedPackages.reduce((sum, pkg) => sum + (pkg.cbm ?? 0), 0),
        6,
      )

      await tx
        .insert(shipmentMeasurements)
        .values({
          orderId: id,
          checkpoint: 'SK_WAREHOUSE',
          measuredWeightKg: checkpointWeightKg.toFixed(3),
          measuredCbm: checkpointCbm.toFixed(6),
          deltaFromSkWeightKg: '0.000',
          deltaFromSkCbm: '0.000000',
          measuredBy: input.verifiedBy,
          measuredAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [shipmentMeasurements.orderId, shipmentMeasurements.checkpoint],
          set: {
            measuredWeightKg: checkpointWeightKg.toFixed(3),
            measuredCbm: checkpointCbm.toFixed(6),
            deltaFromSkWeightKg: '0.000',
            deltaFromSkCbm: '0.000000',
            measuredBy: input.verifiedBy,
            measuredAt: new Date(),
            updatedAt: new Date(),
          },
        })
    })

    await dispatchBatchesService.ensureDraftInvoiceForOrder({
      orderId: id,
      actorId: input.verifiedBy,
      totalUsd: finalChargeUsd,
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

  private assertOrderCanTransition(
    existing: Pick<
      typeof orders.$inferSelect,
      'statusV2' | 'shipmentType' | 'transportMode' | 'paymentCollectionStatus'
    >,
    nextStatus: ShipmentStatusV2,
    options?: {
      requiresExtraTruckMovement?: boolean
    },
  ) {
    const allowSkipExtraTruckMovement = !(options?.requiresExtraTruckMovement ?? false)
    const mode = normalizeTransportMode(
      existing.transportMode ?? resolveTransportModeFromShipmentType(existing.shipmentType),
    )

    if (mode) {
      if (!canTransitionSequentially(
        mode,
        existing.statusV2 as ShipmentStatusV2 | null,
        nextStatus,
        existing.shipmentType as ShipmentType | null,
        { allowSkipExtraTruckMovement },
      )) {
        throw new Error(
          `Invalid status transition: cannot move from "${existing.statusV2 ?? 'none'}" to "${nextStatus}" for ${mode} shipments.`,
        )
      }
    } else {
      if (!isExceptionStatus(nextStatus) && !COMMON_FLOW.includes(nextStatus)) {
        throw new Error(
          `Transport mode must be set via warehouse verification before advancing to "${nextStatus}".`,
        )
      }
      if (
        !isExceptionStatus(nextStatus) &&
        !canTransitionSequentially(
          TransportMode.AIR,
          existing.statusV2 as ShipmentStatusV2 | null,
          nextStatus,
          existing.shipmentType as ShipmentType | null,
          { allowSkipExtraTruckMovement },
        )
      ) {
        throw new Error(
          `Invalid status transition: cannot move from "${existing.statusV2 ?? 'none'}" to "${nextStatus}".`,
        )
      }
    }

    if (nextStatus === ShipmentStatusV2.READY_FOR_PICKUP) {
      if (existing.paymentCollectionStatus !== 'PAID_IN_FULL') {
        throw new Error(
          'Payment must be collected in full before marking the shipment as ready for pickup.',
        )
      }
    }
  }

  private async orderRequiresExtraTruckMovement(orderId: string): Promise<boolean> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderPackages)
      .where(
        and(
          eq(orderPackages.orderId, orderId),
          eq(orderPackages.requiresExtraTruckMovement, true),
        ),
      )
      .limit(1)

    return (row?.count ?? 0) > 0
  }

  private async notifyD2DSuppliersIfNeeded(input: {
    orderId: string
    trackingNumber: string
    statusV2: ShipmentStatusV2
    shipmentType: string | null
    locale: import('../types/enums').PreferredLanguage
  }) {
    if (input.shipmentType !== ShipmentType.D2D) return
    if (!MILESTONE_STATUSES.has(input.statusV2)) return

    const supplierRows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        businessName: users.businessName,
        email: users.email,
        phone: users.phone,
        notifyEmailAlerts: users.notifyEmailAlerts,
        notifySmsAlerts: users.notifySmsAlerts,
        notifyInAppAlerts: users.notifyInAppAlerts,
        preferredLanguage: users.preferredLanguage,
      })
      .from(users)
      .innerJoin(orderPackages, eq(orderPackages.supplierId, users.id))
      .where(
        and(
          eq(orderPackages.orderId, input.orderId),
          eq(users.role, UserRole.SUPPLIER),
          isNull(users.deletedAt),
        ),
      )

    const uniq = new Map<string, (typeof supplierRows)[number]>()
    supplierRows.forEach((row) => uniq.set(row.id, row))

    for (const supplier of uniq.values()) {
      const firstName = supplier.firstName ? decrypt(supplier.firstName) : null
      const lastName = supplier.lastName ? decrypt(supplier.lastName) : null
      const businessName = supplier.businessName ? decrypt(supplier.businessName) : null
      const displayName =
        (firstName && lastName && `${firstName} ${lastName}`) ||
        firstName ||
        businessName ||
        'Supplier'

      if (supplier.notifyInAppAlerts ?? true) {
        notifyUser({
          userId: supplier.id,
          orderId: input.orderId,
          type: 'order_status_update',
          title: 'Customer Shipment Status Updated',
          subtitle: input.trackingNumber,
          body: `A D2D shipment linked to you is now ${input.statusV2.replace(/_/g, ' ')}.`,
          metadata: {
            orderId: input.orderId,
            trackingNumber: input.trackingNumber,
            statusV2: input.statusV2,
          },
        }).catch(() => {})
      }

      const email = supplier.email ? decrypt(supplier.email) : null
      if (email && (supplier.notifyEmailAlerts ?? true)) {
        sendOrderStatusUpdateEmail({
          to: email,
          recipientName: displayName,
          trackingNumber: input.trackingNumber,
          status: input.statusV2,
          templateKey: `order.${input.statusV2.toLowerCase()}`,
          locale: (supplier.preferredLanguage ?? input.locale) as import('../types/enums').PreferredLanguage,
        }).catch(() => {})
      }

      const phone = supplier.phone ? decrypt(supplier.phone) : null
      if (phone && (supplier.notifySmsAlerts ?? true)) {
        sendOrderStatusWhatsApp({
          phone,
          recipientName: displayName,
          trackingNumber: input.trackingNumber,
          status: input.statusV2,
        }).catch(() => {})
      }
    }
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
   * Customer shipments view.
   * Bulk-item flow has been retired in favor of aggregated customer shipments.
   */
  async getMyShipments(userId: string, params: PaginationParams) {
    const rows = await db
      .select({
        id: orders.id,
        trackingNumber: orders.trackingNumber,
        origin: orders.origin,
        destination: orders.destination,
        statusV2: orders.statusV2,
        orderDirection: orders.orderDirection,
        recipientName: orders.recipientName,
        recipientAddress: orders.recipientAddress,
        recipientPhone: orders.recipientPhone,
        recipientEmail: orders.recipientEmail,
        weight: orders.weight,
        declaredValue: orders.declaredValue,
        description: orders.description,
        shipmentType: orders.shipmentType,
        transportMode: orders.transportMode,
        departureDate: orders.departureDate,
        eta: orders.eta,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        invoiceStatus: invoices.status,
        invoiceTotalUsd: invoices.totalUsd,
        invoiceTotalNgn: invoices.totalNgn,
      })
      .from(orders)
      .leftJoin(invoices, eq(invoices.orderId, orders.id))
      .where(and(eq(orders.senderId, userId), isNull(orders.deletedAt)))
      .orderBy(desc(orders.createdAt))

    const normalized = rows.map((o) => {
      const eta = computeEta(o.departureDate, o.shipmentType, o.transportMode)
      return {
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
        shipmentType: o.shipmentType,
        departureDate: o.departureDate ? o.departureDate.toISOString() : null,
        eta,
        invoiceStatus: o.invoiceStatus ?? null,
        invoiceTotalUsd: o.invoiceTotalUsd ?? null,
        invoiceTotalNgn: o.invoiceTotalNgn ?? null,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      }
    })

    const total = normalized.length
    const offset = getPaginationOffset(params.page, params.limit)
    const data = normalized.slice(offset, offset + params.limit)

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

  async getOrderGoodsBreakdown(orderId: string) {
    const rows = await db
      .select({
        id: orderPackages.id,
        description: orderPackages.description,
        itemType: orderPackages.itemType,
        quantity: orderPackages.quantity,
        weightKg: orderPackages.weightKg,
        cbm: orderPackages.cbm,
        lengthCm: orderPackages.lengthCm,
        widthCm: orderPackages.widthCm,
        heightCm: orderPackages.heightCm,
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
      .where(eq(orderPackages.orderId, orderId))
      .orderBy(desc(orderPackages.arrivalAt))

    return rows.map((row) => {
      const supplierFirstName = row.supplierFirstName ? decrypt(row.supplierFirstName) : null
      const supplierLastName = row.supplierLastName ? decrypt(row.supplierLastName) : null
      const supplierBusinessName = row.supplierBusinessName ? decrypt(row.supplierBusinessName) : null
      const supplierName =
        (supplierFirstName && supplierLastName && `${supplierFirstName} ${supplierLastName}`) ||
        supplierFirstName ||
        supplierBusinessName ||
        null

      return {
        id: row.id,
        description: row.description,
        itemType: row.itemType,
        quantity: row.quantity,
        weightKg: row.weightKg,
        cbm: row.cbm,
        dimensionsCm: {
          length: row.lengthCm,
          width: row.widthCm,
          height: row.heightCm,
        },
        itemCostUsd: row.itemCostUsd,
        requiresExtraTruckMovement: row.requiresExtraTruckMovement,
        arrivalAt: row.arrivalAt?.toISOString() ?? null,
        supplierId: row.supplierId ?? null,
        supplierName,
      }
    })
  }

  async getOrderImages(orderId: string) {
    return db
      .select()
      .from(packageImages)
      .where(eq(packageImages.orderId, orderId))
      .orderBy(packageImages.createdAt)
  }

  async getOrderImagesForViewer(params: {
    orderId: string
    viewerId: string
    viewerRole: UserRole
  }) {
    const [order] = await db
      .select({ id: orders.id, senderId: orders.senderId })
      .from(orders)
      .where(and(eq(orders.id, params.orderId), isNull(orders.deletedAt)))
      .limit(1)

    if (!order) {
      return { status: 'not_found' as const }
    }

    if (isExternalViewerRole(params.viewerRole) && order.senderId !== params.viewerId) {
      return { status: 'forbidden' as const }
    }

    const images = await this.getOrderImages(params.orderId)
    return { status: 'ok' as const, images }
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
