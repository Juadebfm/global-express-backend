import type { FastifyRequest, FastifyReply } from 'fastify'
import { shipmentsService } from '../services/shipments.service'
import { dispatchBatchesService } from '../services/dispatch-batches.service'
import { successResponse } from '../utils/response'
import { createAuditLog } from '../utils/audit'
import { UserRole, ShipmentStatusV2, TransportMode } from '../types/enums'

export const shipmentsController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string
        limit?: string
        statusV2?: string
        senderId?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const userRole = request.user.role as UserRole
    const isCustomer = userRole === UserRole.USER || userRole === UserRole.SUPPLIER

    const result = await shipmentsService.list({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      userId: request.user.id,
      isCustomer,
      statusV2: request.query.statusV2 as ShipmentStatusV2 | undefined,
      senderId: !isCustomer ? request.query.senderId : undefined,
    })

    return reply.send(successResponse(result))
  },

  async intakeGoods(
    request: FastifyRequest<{
      Body: {
        customerId: string
        mode: TransportMode
        goods: Array<{
          supplierId: string
          description?: string
          itemType?: string
          quantity?: number
          lengthCm?: number
          widthCm?: number
          heightCm?: number
          weightKg?: number
          cbm?: number
          itemCostUsd?: number
        }>
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await dispatchBatchesService.intakeGoods({
        customerId: request.body.customerId,
        mode: request.body.mode,
        createdBy: request.user.id,
        goods: request.body.goods,
      })

      await createAuditLog({
        userId: request.user.id,
        action: `Intake goods for customer ${request.body.customerId} into batch ${result.batch.id}`,
        resourceType: 'shipment_intake',
        resourceId: result.shipment.id,
        request,
        metadata: {
          batchId: result.batch.id,
          mode: request.body.mode,
          goodsCount: result.appendedGoodsCount,
        },
      })

      return reply.code(201).send(successResponse(result))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Shipment intake failed'
      return reply.code(400).send({ success: false, message })
    }
  },

  async internalTrackByMasterTracking(
    request: FastifyRequest<{ Params: { masterTrackingNumber: string } }>,
    reply: FastifyReply,
  ) {
    const payload = await dispatchBatchesService.getInternalTrackingByMasterTracking(
      request.params.masterTrackingNumber,
    )

    if (!payload) {
      return reply.code(404).send({ success: false, message: 'Dispatch batch not found' })
    }

    return reply.send(successResponse(payload))
  },

  async approveCutoff(
    request: FastifyRequest<{ Params: { batchId: string } }>,
    reply: FastifyReply,
  ) {
    const updated = await dispatchBatchesService.approveCutoff(
      request.params.batchId,
      request.user.id,
    )

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'Open/pending batch not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Approved cutoff for dispatch batch ${request.params.batchId}`,
      resourceType: 'dispatch_batch',
      resourceId: request.params.batchId,
      request,
      metadata: { status: updated.status },
    })

    return reply.send(successResponse(updated))
  },
}
