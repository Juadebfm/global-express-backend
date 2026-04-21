import type { FastifyRequest, FastifyReply } from 'fastify'
import { dashboardService } from '../services/dashboard.service'
import { successResponse } from '../utils/response'

export const dashboardController = {
  async getStats(request: FastifyRequest, reply: FastifyReply) {
    const data = await dashboardService.getStats(request.user.id, request.user.role)
    return reply.send(successResponse(data))
  },

  async getTrends(
    request: FastifyRequest<{ Querystring: { months?: number } }>,
    reply: FastifyReply,
  ) {
    const months = request.query.months ?? 3
    const data = await dashboardService.getTrends(request.user.id, request.user.role, months)
    return reply.send(successResponse(data))
  },

  async getActiveDeliveries(request: FastifyRequest, reply: FastifyReply) {
    const data = await dashboardService.getActiveDeliveries(request.user.id, request.user.role)
    return reply.send(successResponse(data))
  },

  async getAll(
    request: FastifyRequest<{ Querystring: { months?: number } }>,
    reply: FastifyReply,
  ) {
    const months = request.query.months ?? 3
    const [stats, trends, activeDeliveries] = await Promise.all([
      dashboardService.getStats(request.user.id, request.user.role),
      dashboardService.getTrends(request.user.id, request.user.role, months),
      dashboardService.getActiveDeliveries(request.user.id, request.user.role),
    ])
    return reply.send(successResponse({ stats, trends, activeDeliveries }))
  },
}
