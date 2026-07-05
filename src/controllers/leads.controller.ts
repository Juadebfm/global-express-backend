import type { FastifyRequest, FastifyReply } from 'fastify'
import { leadsService } from '../services/leads.service'
import { successResponse } from '../utils/response'
import { createAuditLog } from '../utils/audit'

export const leadsController = {
  async submitD2dIntake(
    request: FastifyRequest<{
      Body: {
        fullName: string
        email?: string
        phone?: string
        originCountry: string
        goodsDescription: string
        estimatedWeightKg?: number
        estimatedCbm?: number
        deliveryPhone?: string
        deliveryAddressLine1?: string
        deliveryState?: string
        deliveryCity?: string
        deliveryLandmark?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const lead = await leadsService.submitD2dIntake(request.body, request.user.id)
    return reply.code(201).send(successResponse(lead))
  },

  async listLeads(
    request: FastifyRequest<{
      Querystring: {
        page?: string
        limit?: string
        leadType?: string
        status?: string
        assignedTo?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const result = await leadsService.listLeads({
      page: Number(request.query.page) || 1,
      limit: Math.min(Number(request.query.limit) || 50, 200),
      leadType: request.query.leadType as 'd2d_intake' | 'shop_inquiry' | undefined,
      status: request.query.status as 'new' | 'contacted' | 'converted' | 'closed' | undefined,
      assignedTo: request.query.assignedTo,
    })
    return reply.send(successResponse(result))
  },

  async getLead(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const lead = await leadsService.getLead(request.params.id)
    return reply.send(successResponse(lead))
  },

  async updateLead(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        status?: 'new' | 'contacted' | 'converted' | 'closed'
        assignedTo?: string | null
        message?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const lead = await leadsService.updateLead(request.params.id, request.body)

    await createAuditLog({
      userId: request.user.id,
      action: 'lead.updated',
      resourceType: 'lead',
      resourceId: request.params.id,
      request,
      metadata: request.body,
    })

    return reply.send(successResponse(lead))
  },

  async deleteLead(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    await leadsService.deleteLead(request.params.id)

    await createAuditLog({
      userId: request.user.id,
      action: 'lead.deleted',
      resourceType: 'lead',
      resourceId: request.params.id,
      request,
    })

    return reply.send(successResponse({ deleted: true }))
  },

  async getMyD2dLeads(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const leads = await leadsService.getMyD2dLeads(request.user.id)
    return reply.send(successResponse(leads))
  },

  async submitShopInquiry(
    request: FastifyRequest<{
      Body: {
        fullName: string
        phone?: string
        email?: string
        message: string
        itemId?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const lead = await leadsService.submitShopInquiry(request.body, request.user.id)
    return reply.code(201).send(successResponse(lead))
  },
}
