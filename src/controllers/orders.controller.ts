import type { FastifyRequest, FastifyReply } from 'fastify'
import { ordersService } from '../services/orders.service'
import { bulkOrdersService } from '../services/bulk-orders.service'
import { usersService } from '../services/users.service'
import { adminNotificationsService } from '../services/admin-notifications.service'
import { broadcastToUser } from '../websocket/handlers'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import type { OrderStatus } from '../types/enums'
import { UserRole } from '../types/enums'

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  failed_delivery: 'Delivery Failed',
  returned: 'Returned to Sender',
  cancelled: 'Cancelled',
}

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
        origin: string
        destination: string
        orderDirection?: 'outbound' | 'inbound'
        weight?: string
        declaredValue?: string
        description?: string
        shipmentType?: 'air' | 'ocean' | 'road'
        priority?: 'standard' | 'express' | 'economy'
        departureDate?: string
        eta?: string
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
      origin: request.body.origin,
      destination: request.body.destination,
      orderDirection: request.body.orderDirection,
      weight: request.body.weight,
      declaredValue: request.body.declaredValue,
      description: request.body.description,
      shipmentType: request.body.shipmentType,
      priority: request.body.priority,
      departureDate: request.body.departureDate ? new Date(request.body.departureDate) : undefined,
      eta: request.body.eta ? new Date(request.body.eta) : undefined,
      createdBy: request.user.id,
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
      Querystring: { page?: string; limit?: string; status?: string; senderId?: string }
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
      status: request.query.status as OrderStatus | undefined,
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
          status: order.status,
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
          status: bulkItem.status,
          updatedAt: bulkItem.updatedAt.toISOString(),
        })),
      )
    }

    return reply.code(404).send({ success: false, message: 'Shipment not found' })
  },

  async updateOrderStatus(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { status: OrderStatus }
    }>,
    reply: FastifyReply,
  ) {
    const order = await ordersService.getOrderById(request.params.id)
    if (!order) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    const sender = await usersService.getUserById(order.senderId)

    const updated = await ordersService.updateOrderStatus(request.params.id, {
      status: request.body.status,
      updatedBy: request.user.id,
      senderEmail: sender?.email,
      senderPhone: sender?.phone ?? undefined,
    })

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'Order not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Updated order ${updated.trackingNumber} status to ${request.body.status}`,
      resourceType: 'order',
      resourceId: updated.id,
      request,
      metadata: { status: request.body.status },
    })

    // Push real-time update to the customer if they have an active WebSocket connection
    broadcastToUser(updated.senderId, {
      type: 'order_status_updated',
      data: {
        orderId: updated.id,
        trackingNumber: updated.trackingNumber,
        status: updated.status,
        updatedAt: updated.updatedAt,
      },
    })

    return reply.send(successResponse(updated))
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

  async getOrderImages(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const images = await ordersService.getOrderImages(request.params.id)
    return reply.send(successResponse(images))
  },
}
