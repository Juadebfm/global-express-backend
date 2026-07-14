import type { FastifyReply, FastifyRequest } from 'fastify'
import { shopService } from '../services/shop.service'
import { parsePaginationQuery } from '../utils/pagination'
import { successResponse } from '../utils/response'
import { UserRole } from '../types/enums'

export const shopController = {
  async listPublicVehicles(
    request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>,
    reply: FastifyReply,
  ) {
    const params = parsePaginationQuery(request.query)
    const payload = await shopService.listPublicVehicles(params)
    return reply.send(successResponse(payload))
  },

  async listPublicItems(
    request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>,
    reply: FastifyReply,
  ) {
    const params = parsePaginationQuery(request.query)
    const payload = await shopService.listPublicItems(params)
    return reply.send(successResponse(payload))
  },

  async submitPublicVehicleInquiry(
    request: FastifyRequest<{
      Params: { listingId: string }
      Body: {
        fullName: string
        email: string
        phone: string
        city?: string
        country?: string
        message?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await shopService.submitPublicVehicleInquiry({
      listingId: request.params.listingId,
      publicContact: {
        fullName: request.body.fullName,
        email: request.body.email,
        phone: request.body.phone,
        city: request.body.city,
        country: request.body.country,
      },
      message: request.body.message,
    })

    return reply.code(201).send(successResponse(payload))
  },

  async submitAuthenticatedItemInquiry(
    request: FastifyRequest<{
      Params: { listingId: string }
      Body: { message?: string }
    }>,
    reply: FastifyReply,
  ) {
    if ([UserRole.STAFF, UserRole.SUPER_ADMIN].includes(request.user.role as UserRole)) {
      return reply.code(403).send({
        success: false,
        message: 'Internal roles cannot submit shop inquiries.',
      })
    }

    const payload = await shopService.submitAuthenticatedItemInquiry({
      listingId: request.params.listingId,
      authClaimant: {
        id: request.user.id,
        role: request.user.role as UserRole,
        fallbackEmail: request.user.email,
      },
      message: request.body.message,
    })

    return reply.code(201).send(successResponse(payload))
  },
}
