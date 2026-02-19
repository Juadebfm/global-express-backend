import type { FastifyRequest, FastifyReply } from 'fastify'
import { reportsService } from '../services/reports.service'
import { successResponse } from '../utils/response'

export const reportsController = {
  async getSummary(_request: FastifyRequest, reply: FastifyReply) {
    const summary = await reportsService.getSummary()
    return reply.send(successResponse(summary))
  },

  async getOrdersByStatus(_request: FastifyRequest, reply: FastifyReply) {
    const data = await reportsService.getOrdersByStatus()
    return reply.send(successResponse(data))
  },

  async getRevenueByPeriod(
    request: FastifyRequest<{
      Querystring: { from?: string; to?: string }
    }>,
    reply: FastifyReply,
  ) {
    const to = request.query.to ? new Date(request.query.to) : new Date()
    const from = request.query.from
      ? new Date(request.query.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000) // default: last 30 days

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ success: false, message: 'Invalid date format' })
    }

    const data = await reportsService.getRevenueByPeriod({ from, to })
    return reply.send(successResponse(data))
  },
}
