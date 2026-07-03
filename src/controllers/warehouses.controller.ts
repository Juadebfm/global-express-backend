import type { FastifyRequest, FastifyReply } from 'fastify'
import { warehousesService } from '../services/warehouses.service'
import { createAuditLog } from '../utils/audit'
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

    await createAuditLog({
      userId: request.user.id,
      action: 'warehouse.created',
      resourceType: 'warehouse',
      resourceId: warehouse.id,
      request,
    })

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

    await createAuditLog({
      userId: request.user.id,
      action: 'warehouse.updated',
      resourceType: 'warehouse',
      resourceId: warehouse.id,
      request,
    })

    return reply.send(successResponse(warehouse))
  },
}
