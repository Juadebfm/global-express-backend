import type { FastifyRequest, FastifyReply } from 'fastify'
import { shipmentsService } from '../services/shipments.service'
import { successResponse } from '../utils/response'
import { UserRole, type OrderStatus } from '../types/enums'

export const shipmentsController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string
        limit?: string
        status?: string
        senderId?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const userRole = request.user.role as UserRole
    const isCustomer = userRole === UserRole.USER

    const result = await shipmentsService.list({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      userId: request.user.id,
      isCustomer,
      status: request.query.status as OrderStatus | undefined,
      senderId: !isCustomer ? request.query.senderId : undefined,
    })

    return reply.send(successResponse(result))
  },
}
