import type { FastifyRequest, FastifyReply } from 'fastify'
import { ordersService } from '../services/orders.service'
import { bulkOrdersService } from '../services/bulk-orders.service'
import { usersService } from '../services/users.service'
import { adminNotificationsService } from '../services/admin-notifications.service'
import { pricingV2Service } from '../services/pricing-v2.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import { ShipmentStatusV2, TransportMode, UserRole } from '../types/enums'
import { STATUS_LABELS } from '../domain/shipment-v2/status-labels'

function formatLastUpdate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${datePart} · ${timePart}`
}

function buildTrackingResponse(params: {
  trackingNumber: string
  origin: string
  destination: string
  status: string
  updatedAt: Date | string
}) {
  return {
    trackingNumber: params.trackingNumber,
    status: params.status,
    statusLabel: STATUS_LABELS[params.status] ?? params.status,
    origin: params.origin,
    destination: params.destination,
    estimatedDelivery: null,
    lastUpdate: formatLastUpdate(params.updatedAt),
    lastLocation: params.destination,
  }
}

export const ordersController = {
  async createOrder(
    request: FastifyRequest<{
      Body: {
        senderId?: string
        recipientName: string
        recipientAddress: string
        recipientPhone: string
        recipientEmail?: string
        orderDirection?: 'outbound' | 'inbound'
        weight?: string
        declaredValue?: string
        description?: string
        shipmentType?: 'air' | 'ocean'
        departureDate?: string
        eta?: string
        pickupRepName?: string
        pickupRepPhone?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const userRole = request.user.role as UserRole

    // Customers always create for themselves — only staff+ can specify a different senderId
    const senderId =
      userRole === UserRole.USER
        ? request.user.id
        : (request.body.senderId ?? request.user.id)

    // Customers must have a complete profile (name, phone, full address) before placing an order.
    // Staff creating on behalf of a customer bypass this check.
    if (userRole === UserRole.USER) {
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
      recipientAddress: request.body.recipientAddress,
      recipientPhone: request.body.recipientPhone,
      recipientEmail: request.body.recipientEmail,
      orderDirection: request.body.orderDirection,
      weight: request.body.weight,
      declaredValue: request.body.declaredValue,
      description: request.body.description,
      shipmentType: request.body.shipmentType,
      departureDate: request.body.departureDate ? new Date(request.body.departureDate) : undefined,
      eta: request.body.eta ? new Date(request.body.eta) : undefined,
      // Customers creating for themselves are pre-ordering (item not yet at warehouse)
      isPreorder: userRole === UserRole.USER,
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
    adminNotificationsService.notify({
      type: 'new_order',
      title: 'New Order Created',
      body: `Order ${order.trackingNumber} was created`,
      metadata: { orderId: order.id, trackingNumber: order.trackingNumber, senderId },
    })

    return reply.code(201).send(successResponse(order))
  },

  async listOrders(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; statusV2?: string; senderId?: string }
    }>,
    reply: FastifyReply,
  ) {
    const userRole = request.user.role as UserRole

    // Regular users only see their own orders
    const senderId =
      userRole === UserRole.USER
        ? request.user.id
        : (request.query.senderId ?? undefined)

    const result = await ordersService.listOrders({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      statusV2: request.query.statusV2 as ShipmentStatusV2 | undefined,
      senderId,
    })

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
    if (userRole === UserRole.USER && order.senderId !== request.user.id) {
      return reply.code(403).send({ success: false, message: 'Forbidden' })
    }

    return reply.send(successResponse(order))
  },

  async trackByTrackingNumber(
    request: FastifyRequest<{ Params: { trackingNumber: string } }>,
    reply: FastifyReply,
  ) {
    const { trackingNumber } = request.params

    // Check solo orders first
    const order = await ordersService.getOrderByTrackingNumber(trackingNumber)
    if (order) {
      return reply.send(
        successResponse(buildTrackingResponse({
          trackingNumber: order.trackingNumber,
          origin: order.origin,
          destination: order.destination,
          status: order.statusV2 ?? '',
          updatedAt: order.updatedAt,
        })),
      )
    }

    // Check bulk shipment items
    const bulkItem = await bulkOrdersService.getBulkItemByTrackingNumber(trackingNumber)
    if (bulkItem) {
      return reply.send(
        successResponse(buildTrackingResponse({
          trackingNumber: bulkItem.trackingNumber,
          origin: bulkItem.origin,
          destination: bulkItem.destination,
          status: bulkItem.statusV2 ?? '',
          updatedAt: bulkItem.updatedAt.toISOString(),
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
        packages: Array<{
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
        }>
        manualFinalChargeUsd?: number
        manualAdjustmentReason?: string
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
          message: 'Only admin or superadmin can approve restricted-item overrides.',
        })
      }

      const updated = await ordersService.verifyOrderAtWarehouse(request.params.id, {
        verifiedBy: request.user.id,
        transportMode: request.body.transportMode,
        packages: request.body.packages,
        manualFinalChargeUsd: request.body.manualFinalChargeUsd,
        manualAdjustmentReason: request.body.manualAdjustmentReason,
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
          hasManualAdjustment: request.body.manualFinalChargeUsd !== undefined,
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
    if (userRole === UserRole.USER && order.senderId !== request.user.id) {
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
      const pricing = await pricingV2Service.calculatePricing({
        customerId: request.user.id,
        mode,
        weightKg: mode === TransportMode.AIR ? weightKg : undefined,
        cbm: mode === TransportMode.SEA ? cbm : undefined,
      })

      const departureFrequency = mode === TransportMode.AIR ? 'Weekly' : 'Monthly'
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
}
