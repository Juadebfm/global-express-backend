import type { FastifyRequest, FastifyReply } from 'fastify'
import { clientsService } from '../services/clients.service'
import { ordersService } from '../services/orders.service'
import { successResponse } from '../utils/response'
import type { OrderStatus } from '../types/enums'

export const clientsController = {
  async list(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; isActive?: string }
    }>,
    reply: FastifyReply,
  ) {
    const isActive =
      request.query.isActive === 'true'
        ? true
        : request.query.isActive === 'false'
          ? false
          : undefined

    const result = await clientsService.listClients({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      isActive,
    })

    return reply.send(successResponse(result))
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }
    return reply.send(successResponse(client))
  },

  async listOrders(
    request: FastifyRequest<{
      Params: { id: string }
      Querystring: { page?: string; limit?: string; status?: string }
    }>,
    reply: FastifyReply,
  ) {
    // Verify client exists
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    const result = await ordersService.listOrders({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      senderId: request.params.id,
      status: request.query.status as OrderStatus | undefined,
    })

    return reply.send(successResponse(result))
  },
}
