import type { FastifyRequest, FastifyReply } from 'fastify'
import { ordersService } from '../services/orders.service'
import { usersService } from '../services/users.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import type { OrderStatus } from '../types/enums'
import { UserRole } from '../types/enums'

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
        weight?: string
        declaredValue?: string
        description?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    // Staff create orders on behalf of clients — default senderId to themselves if not provided
    const senderId = request.body.senderId ?? request.user.id

    const order = await ordersService.createOrder({
      senderId,
      recipientName: request.body.recipientName,
      recipientAddress: request.body.recipientAddress,
      recipientPhone: request.body.recipientPhone,
      recipientEmail: request.body.recipientEmail,
      origin: request.body.origin,
      destination: request.body.destination,
      weight: request.body.weight,
      declaredValue: request.body.declaredValue,
      description: request.body.description,
      createdBy: request.user.id,
    })

    await createAuditLog({
      userId: request.user.id,
      action: `Created order ${order.trackingNumber}`,
      resourceType: 'order',
      resourceId: order.id,
      request,
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
    const order = await ordersService.getOrderByTrackingNumber(request.params.trackingNumber)

    if (!order) {
      return reply.code(404).send({ success: false, message: 'Shipment not found' })
    }

    // Return limited public-safe fields for the tracking page
    return reply.send(
      successResponse({
        trackingNumber: order.trackingNumber,
        origin: order.origin,
        destination: order.destination,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      }),
    )
  },

  async updateOrderStatus(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { status: OrderStatus }
    }>,
    reply: FastifyReply,
  ) {
    // Fetch sender to get contact info for notifications
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
