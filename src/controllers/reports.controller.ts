import type { FastifyRequest, FastifyReply } from 'fastify'
import { reportsService } from '../services/reports.service'
import { successResponse } from '../utils/response'
import { UserRole } from '../types/enums'

/** Default date range: 12 months back → now */
function parseDateRange(query: { from?: string; to?: string }) {
  const to = query.to ? new Date(query.to) : new Date()
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000)
  return { from, to }
}

function invalidDates(from: Date, to: Date) {
  return isNaN(from.getTime()) || isNaN(to.getTime())
}

export const reportsController = {
  // ── Existing ────────────────────────────────────────────────────────────

  async getSummary(_request: FastifyRequest, reply: FastifyReply) {
    const summary = await reportsService.getSummary()
    return reply.send(successResponse(summary))
  },

  async getOrdersByStatus(_request: FastifyRequest, reply: FastifyReply) {
    const data = await reportsService.getOrdersByStatus()
    return reply.send(successResponse(data))
  },

  // ── 1. Revenue Analytics (enhanced) ─────────────────────────────────────

  async getRevenueAnalytics(
    request: FastifyRequest<{
      Querystring: {
        from?: string
        to?: string
        groupBy?: string
        compareToLastPeriod?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const { from, to } = parseDateRange(request.query)
    if (invalidDates(from, to)) {
      return reply.code(400).send({ success: false, message: 'Invalid date format' })
    }

    const groupBy = (request.query.groupBy as 'day' | 'week' | 'month') ?? 'month'
    const compareToLastPeriod = request.query.compareToLastPeriod === 'true'

    const data = await reportsService.getRevenueAnalytics({
      from,
      to,
      groupBy,
      compareToLastPeriod,
    })
    return reply.send(successResponse(data))
  },

  // ── 2. Shipment Volume ──────────────────────────────────────────────────

  async getShipmentVolume(
    request: FastifyRequest<{
      Querystring: { from?: string; to?: string; groupBy?: string }
    }>,
    reply: FastifyReply,
  ) {
    const { from, to } = parseDateRange(request.query)
    if (invalidDates(from, to)) {
      return reply.code(400).send({ success: false, message: 'Invalid date format' })
    }

    const groupBy = (request.query.groupBy as 'day' | 'week' | 'month') ?? 'month'
    const data = await reportsService.getShipmentVolume({ from, to, groupBy })
    return reply.send(successResponse(data))
  },

  // ── 3. Top Customers ────────────────────────────────────────────────────

  async getTopCustomers(
    request: FastifyRequest<{
      Querystring: {
        from?: string
        to?: string
        sortBy?: string
        limit?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const { from, to } = parseDateRange(request.query)
    if (invalidDates(from, to)) {
      return reply.code(400).send({ success: false, message: 'Invalid date format' })
    }

    const sortBy =
      (request.query.sortBy as 'orderCount' | 'totalWeight' | 'revenue') ?? 'orderCount'
    const limit = Math.min(Math.max(Number(request.query.limit) || 10, 5), 50)
    const isSuperAdmin = request.user.role === UserRole.SUPERADMIN

    const data = await reportsService.getTopCustomers({
      from,
      to,
      sortBy,
      limit,
      isSuperAdmin,
    })
    return reply.send(successResponse(data))
  },

  // ── 4. Delivery Performance ─────────────────────────────────────────────

  async getDeliveryPerformance(
    request: FastifyRequest<{
      Querystring: { from?: string; to?: string }
    }>,
    reply: FastifyReply,
  ) {
    const { from, to } = parseDateRange(request.query)
    if (invalidDates(from, to)) {
      return reply.code(400).send({ success: false, message: 'Invalid date format' })
    }

    const data = await reportsService.getDeliveryPerformance({ from, to })
    return reply.send(successResponse(data))
  },

  // ── 5. Status Pipeline ──────────────────────────────────────────────────

  async getStatusPipeline(
    request: FastifyRequest<{
      Querystring: { transportMode?: string }
    }>,
    reply: FastifyReply,
  ) {
    const transportMode = request.query.transportMode as 'air' | 'sea' | undefined
    const data = await reportsService.getStatusPipeline({ transportMode })
    return reply.send(successResponse(data))
  },

  // ── 6. Payment Breakdown ────────────────────────────────────────────────

  async getPaymentBreakdown(
    request: FastifyRequest<{
      Querystring: { from?: string; to?: string }
    }>,
    reply: FastifyReply,
  ) {
    const { from, to } = parseDateRange(request.query)
    if (invalidDates(from, to)) {
      return reply.code(400).send({ success: false, message: 'Invalid date format' })
    }

    const data = await reportsService.getPaymentBreakdown({ from, to })
    return reply.send(successResponse(data))
  },

  // ── 7. Shipment Comparison ──────────────────────────────────────────────

  async getShipmentComparison(
    request: FastifyRequest<{
      Querystring: { from?: string; to?: string }
    }>,
    reply: FastifyReply,
  ) {
    const { from, to } = parseDateRange(request.query)
    if (invalidDates(from, to)) {
      return reply.code(400).send({ success: false, message: 'Invalid date format' })
    }

    const isSuperAdmin = request.user.role === UserRole.SUPERADMIN
    const data = await reportsService.getShipmentComparison({ from, to, isSuperAdmin })
    return reply.send(successResponse(data))
  },
}
