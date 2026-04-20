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
  status: string
  updatedAt: Date | string
  timeline?: Array<{ status: string | null; createdAt: Date }>
  details?: Record<string, unknown>
}) {
  return {
    trackingNumber: params.trackingNumber,
    status: params.status,
    statusLabel: STATUS_LABELS[params.status] ?? params.status,
    origin: params.origin,
    destination: params.destination,
    estimatedDelivery: null,
    lastUpdate: formatLastUpdate(params.updatedAt),
    lastLocation: deriveLastLocation(params.status, params.origin, params.destination),
    timeline: (params.timeline ?? []).map((e) => ({
      status: e.status,
      statusLabel: STATUS_LABELS[e.status ?? ''] ?? e.status,
      timestamp: e.createdAt.toISOString(),
    })),
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
          status: order.statusV2 ?? '',
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
            goodsBreakdown: goods,
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
    const images = await ordersService.getOrderImages(request.params.id)
    return reply.send(successResponse(images))
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

    const events = await orderStatusEventsService.getByOrderId(request.params.id)

    const timeline = events.map((e) => ({
      id: e.id,
      status: e.status,
      statusLabel: STATUS_LABELS[e.status ?? ''] ?? e.status,
      timestamp: e.createdAt.toISOString(),
    }))

    return reply.send(successResponse({
      orderId: order.id,
      trackingNumber: order.trackingNumber,
      currentStatus: order.statusV2,
      currentStatusLabel: STATUS_LABELS[order.statusV2 ?? ''] ?? order.statusV2,
      timeline,
    }))
  },
}
