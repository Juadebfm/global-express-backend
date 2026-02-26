import type { FastifyRequest, FastifyReply } from 'fastify'
import { shipmentsService } from '../services/shipments.service'
import { successResponse } from '../utils/response'
import { UserRole, ShipmentStatusV2 } from '../types/enums'

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
    const isCustomer = userRole === UserRole.USER

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
}
