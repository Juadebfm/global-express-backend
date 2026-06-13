import type { FastifyRequest, FastifyReply } from 'fastify'
import { batchesService, STATUS_LABELS } from '../services/batches.service'
import { successResponse } from '../utils/response'
import { createAuditLog } from '../utils/audit'
import { ShipmentStatusV2 } from '../types/enums'

export const batchesController = {

  async createBatch(
    request: FastifyRequest<{ Body: { transportMode: 'air' | 'sea' } }>,
    reply: FastifyReply,
  ) {
    const batch = await batchesService.createBatch({
      transportMode: request.body.transportMode,
      actorId: request.user.id,
    })

    await createAuditLog({
      userId: request.user.id,
      action: 'batch_created',
      resourceType: 'batch',
      resourceId: batch.id,
      request,
      metadata: { transportMode: request.body.transportMode, masterTrackingNumber: batch.masterTrackingNumber },
    })

    return reply.code(201).send(successResponse(batch))
  },

  async listBatches(
    request: FastifyRequest<{
      Querystring: { status?: string; transportMode?: string; page?: string; limit?: string }
    }>,
    reply: FastifyReply,
  ) {
    const data = await batchesService.listBatches({
      status: request.query.status,
      transportMode: request.query.transportMode,
      page: Math.max(Number(request.query.page) || 1, 1),
      limit: Math.min(Math.max(Number(request.query.limit) || 20, 1), 100),
    })

    return reply.send(successResponse(data))
  },

  async getBatch(
    request: FastifyRequest<{ Params: { batchId: string } }>,
    reply: FastifyReply,
  ) {
    const batch = await batchesService.getBatch(request.params.batchId)
    if (!batch) return reply.code(404).send({ success: false, message: 'Batch not found.' })
    return reply.send(successResponse(batch))
  },

  async getBatchRoster(
    request: FastifyRequest<{ Params: { batchId: string } }>,
    reply: FastifyReply,
  ) {
    const roster = await batchesService.getBatchRoster(request.params.batchId)
    if (!roster) return reply.code(404).send({ success: false, message: 'Batch not found.' })
    return reply.send(successResponse(roster))
  },

  async addOrderToBatch(
    request: FastifyRequest<{ Params: { batchId: string }; Body: { orderId: string } }>,
    reply: FastifyReply,
  ) {
    const result = await batchesService.addOrderToBatch({
      orderId: request.body.orderId,
      actorId: request.user.id,
    })

    if (!result.ok) {
      return reply.code(422).send({ success: false, message: result.reason })
    }

    await createAuditLog({
      userId: request.user.id,
      action: 'order_added_to_batch',
      resourceType: 'batch',
      resourceId: result.batchId,
      request,
      metadata: {
        orderId: request.body.orderId,
        masterTrackingNumber: result.masterTrackingNumber,
        batchTrackingNumber: result.batchTrackingNumber,
        newCustomerSlot: result.isNewSlot,
      },
    })

    return reply.send(successResponse(result))
  },

  async removeOrderFromBatch(
    request: FastifyRequest<{ Params: { batchId: string; orderId: string } }>,
    reply: FastifyReply,
  ) {
    const result = await batchesService.removeOrderFromBatch({
      batchId: request.params.batchId,
      orderId: request.params.orderId,
    })

    if (!result.ok) {
      return reply.code(422).send({ success: false, message: result.reason })
    }

    await createAuditLog({
      userId: request.user.id,
      action: 'order_removed_from_batch',
      resourceType: 'batch',
      resourceId: request.params.batchId,
      request,
      metadata: { orderId: request.params.orderId },
    })

    return reply.send(successResponse({ message: 'Order removed from batch.' }))
  },

  async updateBatchStatus(
    request: FastifyRequest<{ Params: { batchId: string }; Body: { status: string } }>,
    reply: FastifyReply,
  ) {
    const result = await batchesService.updateBatchStatus({
      batchId: request.params.batchId,
      newStatus: request.body.status as ShipmentStatusV2,
      actorId: request.user.id,
    })

    if (!result.ok) {
      return reply.code(422).send({ success: false, message: result.reason })
    }

    await createAuditLog({
      userId: request.user.id,
      action: 'batch_status_updated',
      resourceType: 'batch',
      resourceId: request.params.batchId,
      request,
      metadata: { newStatus: request.body.status, updatedOrderCount: result.updatedOrderCount },
    })

    return reply.send(successResponse(result))
  },

  async closeBatch(
    request: FastifyRequest<{ Params: { batchId: string } }>,
    reply: FastifyReply,
  ) {
    const result = await batchesService.closeBatch({
      batchId: request.params.batchId,
      actorId: request.user.id,
    })

    if (!result.ok) {
      const statusCode = 'unverifiedOrders' in result ? 422 : 422
      return reply.code(statusCode).send({ success: false, message: result.reason })
    }

    await createAuditLog({
      userId: request.user.id,
      action: 'batch_closed',
      resourceType: 'batch',
      resourceId: request.params.batchId,
      request,
      metadata: {
        customersNotified: result.customersNotified,
        nextBatchId: result.nextBatch.id,
        nextBatchTrackingNumber: result.nextBatch.masterTrackingNumber,
      },
    })

    return reply.send(successResponse(result))
  },

  async getStatusLabels(_request: FastifyRequest, reply: FastifyReply) {
    const labels = Object.entries(STATUS_LABELS).map(([status, info]) => ({
      status,
      label: info.label,
      description: info.description,
    }))
    return reply.send(successResponse(labels))
  },
}
