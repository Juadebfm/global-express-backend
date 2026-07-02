import type { FastifyRequest, FastifyReply } from 'fastify'
import { surchargesService } from '../services/surcharges.service'
import { successResponse } from '../utils/response'

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
    return reply.status(201).send(successResponse(surcharge))
  },

  async removeSurcharge(
    request: FastifyRequest<{ Params: { orderId: string; surchargeId: string } }>,
    reply: FastifyReply,
  ) {
    await surchargesService.removeSurcharge(request.params.surchargeId)
    return reply.send(successResponse({ deleted: true }))
  },
}
