import type { FastifyRequest, FastifyReply } from 'fastify'
import { ordersService } from '../services/orders.service'
import { orderStatusEventsService } from '../services/order-status-events.service'
import { dispatchBatchesService } from '../services/dispatch-batches.service'
import { usersService } from '../services/users.service'
import { notificationsService } from '../services/notifications.service'
import { pricingV2Service } from '../services/pricing-v2.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import { ShipmentPayer, ShipmentStatusV2, TransportMode, UserRole } from '../types/enums'
import { STATUS_LABELS } from '../domain/shipment-v2/status-labels'
import {
  getCustomerTrackingStatusLabel,
  toCustomerTrackingStatus,
} from '../domain/shipment-v2/customer-tracking-status'

const SEA_CBM_TO_KG_FACTOR = 550

function isCustomerRole(role: UserRole): boolean {
  return role === UserRole.USER || role === UserRole.SUPPLIER
}

function maskOrderForExternalViewer<T extends Record<string, unknown>>(
  order: T,
  role: UserRole,
): T {
  if (!isCustomerRole(role)) return order
  return {
    ...order,
    senderId: null,
  }
}

function formatLastUpdate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${datePart} · ${timePart}`
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildCargoMetrics(goods: Array<{ weightKg: string | null; cbm: string | null }>) {
  const totalWeightKg = goods.reduce((sum, item) => sum + toNumber(item.weightKg), 0)
  const totalCbm = goods.reduce((sum, item) => sum + toNumber(item.cbm), 0)

  return {
    packageCount: goods.length,
    totalWeightKg: totalWeightKg.toFixed(3),
    totalCbm: totalCbm.toFixed(6),
  }
}

type TrackingTimelineEvent = {
  id?: string
  status: string | null
  createdAt: Date
}

function mapTrackingTimeline(
  events: TrackingTimelineEvent[],
  includeInternalStatus: boolean,
) {
  const timeline: Array<{
    id?: string
    status: string | null
    statusLabel: string | null
    timestamp: string
    internalStatus?: string | null
    internalStatusLabel?: string | null
  }> = []

  for (const event of events) {
    const mappedStatus = toCustomerTrackingStatus(event.status)
    const previous = timeline.at(-1)

    // Collapse repeated internal transitions into one customer-facing timeline status.
    if (previous && previous.status === mappedStatus) {
      continue
    }

    timeline.push({
      ...(includeInternalStatus && event.id ? { id: event.id } : {}),
      status: mappedStatus,
      statusLabel: getCustomerTrackingStatusLabel(mappedStatus),
      timestamp: event.createdAt.toISOString(),
      ...(includeInternalStatus
        ? {
            internalStatus: event.status,
            internalStatusLabel: event.status ? (STATUS_LABELS[event.status] ?? event.status) : null,
          }
        : {}),
    })
  }

  return timeline
}

/** Derive last known location from the shipment status */
function deriveLastLocation(status: string, origin: string, destination: string): string {
  // Statuses where the shipment is still at or near the origin
  const atOrigin: string[] = [
    ShipmentStatusV2.PREORDER_SUBMITTED,
    ShipmentStatusV2.AWAITING_WAREHOUSE_RECEIPT,
    ShipmentStatusV2.WAREHOUSE_RECEIVED,
    ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
    ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT,
    ShipmentStatusV2.AT_ORIGIN_AIRPORT,
    ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT,
    ShipmentStatusV2.AT_ORIGIN_PORT,
    ShipmentStatusV2.ON_HOLD,
    ShipmentStatusV2.RESTRICTED_ITEM_REJECTED,
    ShipmentStatusV2.RESTRICTED_ITEM_OVERRIDE_APPROVED,
  ]

  // Statuses where the shipment is in transit between origin and destination
  const inTransit: string[] = [
    ShipmentStatusV2.BOARDED_ON_FLIGHT,
    ShipmentStatusV2.FLIGHT_DEPARTED,
    ShipmentStatusV2.LOADED_ON_VESSEL,
    ShipmentStatusV2.VESSEL_DEPARTED,
  ]

  if (atOrigin.includes(status)) return origin
  if (inTransit.includes(status)) return 'In Transit'
  return destination
}

function buildTrackingResponse(params: {
  trackingNumber: string
  origin: string
  destination: string
  internalStatus: string | null
  updatedAt: Date | string
  timeline?: TrackingTimelineEvent[]
  details?: Record<string, unknown>
  includeInternalStatus?: boolean
}) {
  const customerStatus = toCustomerTrackingStatus(params.internalStatus)

  return {
    trackingNumber: params.trackingNumber,
    status: customerStatus,
    statusLabel: getCustomerTrackingStatusLabel(customerStatus),
    origin: params.origin,
    destination: params.destination,
    estimatedDelivery: null,
    lastUpdate: formatLastUpdate(params.updatedAt),
    lastLocation: deriveLastLocation(params.internalStatus ?? '', params.origin, params.destination),
    timeline: mapTrackingTimeline(params.timeline ?? [], Boolean(params.includeInternalStatus)),
    ...(params.includeInternalStatus
      ? {
          internalStatus: params.internalStatus,
          internalStatusLabel: params.internalStatus
            ? (STATUS_LABELS[params.internalStatus] ?? params.internalStatus)
            : null,
        }
      : {}),
    ...(params.details ?? {}),
  }
}

export const ordersController = {
  async createOrder(
    request: FastifyRequest<{
      Body: {
        senderId?: string
        recipientName: string
        recipientAddress?: string
        recipientPhone: string
        recipientEmail?: string
        orderDirection?: 'outbound' | 'inbound'
        weight?: string
        declaredValue?: string
        description?: string
        shipmentType?: 'air' | 'ocean' | 'd2d'
        shipmentPayer?: ShipmentPayer
        billingSupplierId?: string
        pickupRepName?: string
        pickupRepPhone?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const userRole = request.user.role as UserRole

    // Customers always create for themselves — only staff+ can specify a different senderId
    const senderId = isCustomerRole(userRole)
      ? request.user.id
      : (request.body.senderId ?? request.user.id)
    const shipmentPayer = isCustomerRole(userRole)
      ? ShipmentPayer.USER
      : (request.body.shipmentPayer ?? ShipmentPayer.USER)

    if (shipmentPayer === ShipmentPayer.SUPPLIER && !request.body.billingSupplierId) {
      return reply.code(400).send({
        success: false,
        message: 'billingSupplierId is required when shipmentPayer is SUPPLIER.',
      })
    }

    // Customers must have a complete profile (name, phone, full address) before placing an order.
    // Staff creating on behalf of a customer bypass this check.
    if (isCustomerRole(userRole)) {
      const profile = await usersService.getUserById(request.user.id)
      if (!profile || !usersService.isProfileComplete(profile)) {
        return reply.code(422).send({
          success: false,
          message:
            'Please complete your profile before placing an order. Required: name (or business name), phone number, and full address (street, city, state, country, postal code).',
        })
      }
    }

    const order = await ordersService.createOrder({
      senderId,
      recipientName: request.body.recipientName,
      recipientAddress: '58B Awoniyi Elemo Street, Ajao Estate, Lagos, Nigeria',
      recipientPhone: request.body.recipientPhone,
      recipientEmail: request.body.recipientEmail,
      orderDirection: request.body.orderDirection,
      weight: request.body.weight,
      declaredValue: request.body.declaredValue,
      description: request.body.description,
      shipmentType: request.body.shipmentType,
      shipmentPayer,
      billingSupplierId: shipmentPayer === ShipmentPayer.SUPPLIER
        ? request.body.billingSupplierId ?? null
        : null,
      // Customers creating for themselves are pre-ordering (item not yet at warehouse)
      isPreorder: isCustomerRole(userRole),
      createdBy: request.user.id,
      pickupRepName: request.body.pickupRepName,
      pickupRepPhone: request.body.pickupRepPhone,
    })

    await createAuditLog({
      userId: request.user.id,
      action: `Created order ${order.trackingNumber}`,
      resourceType: 'order',
      resourceId: order.id,
      request,
    })

    // Fire-and-forget: notify superadmin of new order
    notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'new_order',
      title: 'New Order Created',
      body: `Order ${order.trackingNumber} was created`,
      metadata: { orderId: order.id, trackingNumber: order.trackingNumber, senderId },
    })

    return reply.code(201).send(successResponse(maskOrderForExternalViewer(order, userRole)))
  },

  async listOrders(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; statusV2?: string; senderId?: string }
    }>,
    reply: FastifyReply,
  ) {
    const userRole = request.user.role as UserRole

    // Regular users only see their own orders
    const senderId = isCustomerRole(userRole)
      ? request.user.id
      : (request.query.senderId ?? undefined)

    const result = await ordersService.listOrders({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      statusV2: request.query.statusV2 as ShipmentStatusV2 | undefined,
      senderId,
    })

    if (isCustomerRole(userRole)) {
      const masked = {
        ...result,
        data: result.data.map((order) => maskOrderForExternalViewer(order, userRole)),
      }
      return reply.send(successResponse(masked))
    }

    return reply.send(successResponse(result))
  },

  async getMyShipments(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await ordersService.getMyShipments(request.user.id, {
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
    })

    return reply.send(successResponse(result))
  },

  async getOrderById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const order = await ordersService.getOrderById(request.params.id)

    if (!order) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    // Users can only view their own orders
    const userRole = request.user.role as UserRole
    if (isCustomerRole(userRole) && order.senderId !== request.user.id) {
      return reply.code(403).send({ success: false, message: 'Forbidden' })
    }

    return reply.send(successResponse(maskOrderForExternalViewer(order, userRole)))
  },

  async trackByTrackingNumber(
    request: FastifyRequest<{ Params: { trackingNumber: string } }>,
    reply: FastifyReply,
  ) {
    const { trackingNumber } = request.params

    const order = await ordersService.getOrderByTrackingNumber(trackingNumber)
    if (order) {
      const [events, goods, invoice] = await Promise.all([
        orderStatusEventsService.getByOrderId(order.id),
        ordersService.getOrderGoodsBreakdown(order.id),
        dispatchBatchesService.getInvoiceByOrderId(order.id),
      ])

      const distinctVendors = new Set(
        goods.map((g) => g.supplierId).filter((id): id is string => typeof id === 'string'),
      )
      const paymentStatus =
        invoice
          ? await dispatchBatchesService.getPaymentStatusForInvoice(invoice.id)
          : order.paymentCollectionStatus === 'PAID_IN_FULL'
            ? 'completed'
            : 'pending'

      return reply.send(
        successResponse(buildTrackingResponse({
          trackingNumber: order.trackingNumber,
          origin: order.origin,
          destination: order.destination,
          internalStatus: order.statusV2 ?? null,
          updatedAt: order.updatedAt,
          timeline: events,
          details: {
            paymentStatus,
            estimatedDelivery: order.eta ?? null,
            shipmentCost: {
              usd: invoice?.totalUsd ?? order.finalChargeUsd ?? order.calculatedChargeUsd ?? null,
              ngn: invoice?.totalNgn ?? null,
              invoiceStatus: invoice?.status ?? null,
            },
            vendorCount: distinctVendors.size,
            cargoMetrics: buildCargoMetrics(goods),
          },
        })),
      )
    }

    return reply.code(404).send({ success: false, message: 'Shipment not found' })
  },

  async updateOrderStatus(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { statusV2: ShipmentStatusV2 }
    }>,
    reply: FastifyReply,
  ) {
    const order = await ordersService.getOrderById(request.params.id)
    if (!order) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    if (order.dispatchBatchId) {
      return reply.code(409).send({
        success: false,
        message:
          'This shipment is managed at batch level. Use PATCH /api/v1/shipments/batches/:batchId/status instead.',
      })
    }

    const sender = await usersService.getUserById(order.senderId)

    let updated: Awaited<ReturnType<typeof ordersService.updateOrderStatus>>
    try {
      updated = await ordersService.updateOrderStatus(request.params.id, {
        statusV2: request.body.statusV2,
        updatedBy: request.user.id,
        actorRole: request.user.role as UserRole,
        senderEmail: sender?.email,
        senderPhone: sender?.phone ?? undefined,
        notifyEmailAlerts: sender?.notifyEmailAlerts,
        notifySmsAlerts: sender?.notifySmsAlerts,
        notifyInAppAlerts: sender?.notifyInAppAlerts,
        preferredLanguage: sender?.preferredLanguage ?? 'en',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Status update failed'
      return reply.code(400).send({ success: false, message })
    }

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Updated order ${updated.trackingNumber} status to ${request.body.statusV2}`,
      resourceType: 'order',
      resourceId: updated.id,
      request,
      metadata: { statusV2: request.body.statusV2 },
    })

    return reply.send(successResponse(updated))
  },

  async verifyOrderAtWarehouse(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        transportMode?: TransportMode
        departureDate?: string
        packages: Array<{
          supplierId?: string
          arrivalAt?: string
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
          isRestricted?: boolean
          restrictedReason?: string
          restrictedOverrideApproved?: boolean
          restrictedOverrideReason?: string
        }>
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const hasRestrictedOverride = request.body.packages.some(
        (pkg) => pkg.restrictedOverrideApproved,
      )
      if (hasRestrictedOverride && request.user.role === UserRole.STAFF) {
        return reply.code(403).send({
          success: false,
          message: 'Only superadmin can approve restricted-item overrides.',
        })
      }

      const updated = await ordersService.verifyOrderAtWarehouse(request.params.id, {
        verifiedBy: request.user.id,
        transportMode: request.body.transportMode,
        departureDate: request.body.departureDate ? new Date(request.body.departureDate) : undefined,
        packages: request.body.packages.map((pkg) => ({
          ...pkg,
          arrivalAt: pkg.arrivalAt ? new Date(pkg.arrivalAt) : undefined,
        })),
      })

      if (!updated) {
        return reply.code(404).send({ success: false, message: 'Order not found' })
      }

      await createAuditLog({
        userId: request.user.id,
        action: `Verified warehouse details and pricing for order ${updated.trackingNumber}`,
        resourceType: 'order',
        resourceId: updated.id,
        request,
        metadata: {
          transportMode: request.body.transportMode ?? updated.transportMode,
          packageCount: request.body.packages.length,
        },
      })

      return reply.send(successResponse(updated))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Warehouse verification failed'
      return reply.code(400).send({ success: false, message })
    }
  },

  async deleteOrder(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const deleted = await ordersService.softDeleteOrder(request.params.id)

    if (!deleted) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Soft-deleted order ${request.params.id}`,
      resourceType: 'order',
      resourceId: request.params.id,
      request,
    })

    return reply.send(successResponse({ message: 'Order deleted successfully' }))
  },

  async updatePickupRep(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { pickupRepName: string; pickupRepPhone: string }
    }>,
    reply: FastifyReply,
  ) {
    const order = await ordersService.getOrderById(request.params.id)
    if (!order) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    // Customers can only update their own orders
    const userRole = request.user.role as UserRole
    if (isCustomerRole(userRole) && order.senderId !== request.user.id) {
      return reply.code(403).send({ success: false, message: 'Forbidden' })
    }

    const updated = await ordersService.updatePickupRep(request.params.id, {
      pickupRepName: request.body.pickupRepName,
      pickupRepPhone: request.body.pickupRepPhone,
    })

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    return reply.send(successResponse(updated))
  },

  async getOrderImages(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const result = await ordersService.getOrderImagesForViewer({
      orderId: request.params.id,
      viewerId: request.user.id,
      viewerRole: request.user.role as UserRole,
    })

    if (result.status === 'not_found') {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    if (result.status === 'forbidden') {
      return reply.code(403).send({ success: false, message: 'Forbidden' })
    }

    return reply.send(successResponse(result.images))
  },

  async estimateShippingCost(
    request: FastifyRequest<{
      Body: {
        shipmentType: 'air' | 'ocean'
        weightKg?: number
        cbm?: number
      }
    }>,
    reply: FastifyReply,
  ) {
    const { shipmentType, weightKg, cbm } = request.body

    const mode = shipmentType === 'air' ? TransportMode.AIR : TransportMode.SEA

    if (mode === TransportMode.AIR && (!weightKg || weightKg <= 0)) {
      return reply.code(400).send({
        success: false,
        message: 'weightKg is required and must be positive for air shipments',
      })
    }

    if (mode === TransportMode.SEA && (!cbm || cbm <= 0)) {
      return reply.code(400).send({
        success: false,
        message: 'cbm is required and must be positive for sea/ocean shipments',
      })
    }

    try {
      const seaChargeableWeightKg =
        mode === TransportMode.SEA && cbm ? cbm * SEA_CBM_TO_KG_FACTOR : undefined

      const pricing = await pricingV2Service.calculatePricing({
        customerId: request.user.id,
        mode,
        weightKg:
          mode === TransportMode.AIR
            ? weightKg
            : mode === TransportMode.SEA
              ? seaChargeableWeightKg
              : undefined,
        cbm: mode === TransportMode.SEA ? cbm : undefined,
      })

      const departureFrequency = 'Event-driven (based on warehouse movement)'
      const estimatedTransitDays = mode === TransportMode.AIR ? 7 : 90

      return reply.send(
        successResponse({
          mode,
          weightKg: weightKg ?? null,
          cbm: cbm ?? null,
          estimatedCostUsd: pricing.amountUsd,
          pricingSource: pricing.pricingSource,
          departureFrequency,
          estimatedTransitDays,
          disclaimer:
            'This is an estimate. Final pricing is determined after warehouse verification of actual weight/volume. Rates are subject to change without prior notice.',
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pricing calculation failed'
      return reply.code(400).send({ success: false, message })
    }
  },

  async getStatusTimeline(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const order = await ordersService.getOrderById(request.params.id)
    if (!order) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    const userRole = request.user.role as UserRole
    if (isCustomerRole(userRole) && order.senderId !== request.user.id) {
      return reply.code(403).send({ success: false, message: 'Forbidden' })
    }

    const [events, goods, invoice] = await Promise.all([
      orderStatusEventsService.getByOrderId(request.params.id),
      ordersService.getOrderGoodsBreakdown(request.params.id),
      dispatchBatchesService.getInvoiceByOrderId(request.params.id),
    ])

    const distinctVendors = new Set(
      goods.map((g) => g.supplierId).filter((id): id is string => typeof id === 'string'),
    )
    const paymentStatus =
      invoice
        ? await dispatchBatchesService.getPaymentStatusForInvoice(invoice.id)
        : order.paymentCollectionStatus === 'PAID_IN_FULL'
          ? 'completed'
          : 'pending'

    return reply.send(successResponse({
      orderId: order.id,
      ...buildTrackingResponse({
        trackingNumber: order.trackingNumber,
        origin: order.origin,
        destination: order.destination,
        internalStatus: order.statusV2 ?? null,
        updatedAt: order.updatedAt,
        timeline: events,
        includeInternalStatus: true,
        details: {
          paymentStatus,
          estimatedDelivery: order.eta ?? null,
          shipmentCost: {
            usd: invoice?.totalUsd ?? order.finalChargeUsd ?? order.calculatedChargeUsd ?? null,
            ngn: invoice?.totalNgn ?? null,
            invoiceStatus: invoice?.status ?? null,
          },
          vendorCount: distinctVendors.size,
          cargoMetrics: buildCargoMetrics(goods),
          goodsBreakdown: goods,
          invoice: invoice
            ? {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                status: invoice.status,
                shipmentPayer: invoice.shipmentPayer,
                totalUsd: invoice.totalUsd,
                totalNgn: invoice.totalNgn,
                fxRateNgnPerUsd: invoice.fxRateNgnPerUsd,
                finalizedAt: invoice.finalizedAt?.toISOString() ?? null,
                paidAt: invoice.paidAt?.toISOString() ?? null,
              }
            : null,
        },
      }),
    }))
  },
}
