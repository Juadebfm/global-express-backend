import type { FastifyRequest, FastifyReply } from 'fastify'
import { warehousesService } from '../services/warehouses.service'
import { successResponse } from '../utils/response'

export const warehousesController = {
  async listWarehouses(
    request: FastifyRequest<{ Querystring: { includeInactive?: boolean } }>,
    reply: FastifyReply,
  ) {
    const warehouses = await warehousesService.listWarehouses(request.query.includeInactive)
    return reply.send(successResponse(warehouses))
  },

  async createWarehouse(
    request: FastifyRequest<{ Body: { name: string; city: string; country?: string } }>,
    reply: FastifyReply,
  ) {
    const warehouse = await warehousesService.createWarehouse(request.body)
    return reply.code(201).send(successResponse(warehouse))
  },

  async updateWarehouse(
    request: FastifyRequest<{
      Params: { id: string }
      Body: Partial<{ name: string; city: string; country: string; isActive: boolean }>
    }>,
    reply: FastifyReply,
  ) {
    const warehouse = await warehousesService.updateWarehouse(request.params.id, request.body)
    return reply.send(successResponse(warehouse))
  },
}
