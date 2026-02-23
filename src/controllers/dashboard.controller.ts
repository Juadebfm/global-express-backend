import type { FastifyRequest, FastifyReply } from 'fastify'
import { dashboardService } from '../services/dashboard.service'
import { successResponse } from '../utils/response'

export const dashboardController = {
  async getStats(request: FastifyRequest, reply: FastifyReply) {
    const data = await dashboardService.getStats(request.user.id, request.user.role)
    return reply.send(successResponse(data))
  },

  async getTrends(
    request: FastifyRequest<{ Querystring: { year?: number } }>,
    reply: FastifyReply,
  ) {
    const year = request.query.year ?? new Date().getFullYear()
    const data = await dashboardService.getTrends(request.user.id, request.user.role, year)
    return reply.send(successResponse(data))
  },

  async getActiveDeliveries(request: FastifyRequest, reply: FastifyReply) {
    const data = await dashboardService.getActiveDeliveries(request.user.id, request.user.role)
    return reply.send(successResponse(data))
  },
}
