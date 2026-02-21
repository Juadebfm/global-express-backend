import type { FastifyRequest, FastifyReply } from 'fastify'
import { bulkOrdersService } from '../services/bulk-orders.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import type { OrderStatus } from '../types/enums'
import type { CreateBulkItemInput } from '../services/bulk-orders.service'

export const bulkOrdersController = {
  async createBulkOrder(
    request: FastifyRequest<{
      Body: {
        origin: string
        destination: string
        notes?: string
        items: CreateBulkItemInput[]
      }
    }>,
    reply: FastifyReply,
  ) {
    const bulk = await bulkOrdersService.createBulkOrder({
      origin: request.body.origin,
      destination: request.body.destination,
      notes: request.body.notes,
      createdBy: request.user.id,
      items: request.body.items,
    })

    await createAuditLog({
      userId: request.user.id,
      action: `Created bulk order ${bulk.trackingNumber} with ${bulk.items.length} items`,
      resourceType: 'bulk_order',
      resourceId: bulk.id,
      request,
    })

    return reply.code(201).send(successResponse(bulk))
  },

  async listBulkOrders(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await bulkOrdersService.listBulkOrders({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
    })

    return reply.send(successResponse(result))
  },

  async getBulkOrderById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const bulk = await bulkOrdersService.getBulkOrderById(request.params.id)

    if (!bulk) {
      return reply.code(404).send({ success: false, message: 'Bulk order not found' })
    }

    return reply.send(successResponse(bulk))
  },

  async updateBulkOrderStatus(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { status: OrderStatus }
    }>,
    reply: FastifyReply,
  ) {
    const updated = await bulkOrdersService.updateBulkOrderStatus(
      request.params.id,
      request.body.status,
    )

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'Bulk order not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Updated bulk order ${request.params.id} status to ${request.body.status}`,
      resourceType: 'bulk_order',
      resourceId: request.params.id,
      request,
      metadata: { status: request.body.status },
    })

    return reply.send(successResponse(updated))
  },

  async addItem(
    request: FastifyRequest<{
      Params: { id: string }
      Body: CreateBulkItemInput
    }>,
    reply: FastifyReply,
  ) {
    const item = await bulkOrdersService.addItemToBulkOrder(request.params.id, request.body)

    if (!item) {
      return reply.code(404).send({ success: false, message: 'Bulk order not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Added item ${item.trackingNumber} to bulk order ${request.params.id}`,
      resourceType: 'bulk_order',
      resourceId: request.params.id,
      request,
    })

    return reply.code(201).send(successResponse(item))
  },

  async removeItem(
    request: FastifyRequest<{ Params: { id: string; itemId: string } }>,
    reply: FastifyReply,
  ) {
    const deleted = await bulkOrdersService.removeItemFromBulkOrder(
      request.params.id,
      request.params.itemId,
    )

    if (!deleted) {
      return reply.code(404).send({ success: false, message: 'Item not found in bulk order' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Removed item ${request.params.itemId} from bulk order ${request.params.id}`,
      resourceType: 'bulk_order',
      resourceId: request.params.id,
      request,
    })

    return reply.send(successResponse({ message: 'Item removed from bulk order' }))
  },

  async deleteBulkOrder(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const deleted = await bulkOrdersService.softDeleteBulkOrder(request.params.id)

    if (!deleted) {
      return reply.code(404).send({ success: false, message: 'Bulk order not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Soft-deleted bulk order ${request.params.id}`,
      resourceType: 'bulk_order',
      resourceId: request.params.id,
      request,
    })

    return reply.send(successResponse({ message: 'Bulk order deleted successfully' }))
  },
}
