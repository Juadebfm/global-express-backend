import type { FastifyRequest, FastifyReply } from 'fastify'
import { surchargesService } from '../services/surcharges.service'
import { successResponse } from '../utils/response'
import { createAuditLog } from '../utils/audit'

export const surchargesController = {
  async listSurcharges(request: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) {
    const list = await surchargesService.listSurcharges(request.params.orderId)
    return reply.send(successResponse(list))
  },

  async addSurcharge(
    request: FastifyRequest<{
      Params: { orderId: string }
      Body: { type: string; label: string; amountUsd: number; notes?: string }
    }>,
    reply: FastifyReply,
  ) {
    const surcharge = await surchargesService.addSurcharge({
      orderId: request.params.orderId,
      type: request.body.type,
      label: request.body.label,
      amountUsd: request.body.amountUsd,
      notes: request.body.notes,
      addedBy: request.user.id,
    })

    await createAuditLog({
      userId: request.user.id,
      action: 'surcharge.added',
      resourceType: 'order',
      resourceId: request.params.orderId,
      request,
      metadata: {
        orderId: request.params.orderId,
        type: request.body.type,
        label: request.body.label,
        amountUsd: request.body.amountUsd,
      },
    })

    return reply.status(201).send(successResponse(surcharge))
  },

  async removeSurcharge(
    request: FastifyRequest<{ Params: { orderId: string; surchargeId: string } }>,
    reply: FastifyReply,
  ) {
    await surchargesService.removeSurcharge(request.params.surchargeId)

    await createAuditLog({
      userId: request.user.id,
      action: 'surcharge.removed',
      resourceType: 'order',
      resourceId: request.params.orderId,
      request,
      metadata: {
        surchargeId: request.params.surchargeId,
        orderId: request.params.orderId,
      },
    })

    return reply.send(successResponse({ deleted: true }))
  },
}
