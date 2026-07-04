import type { FastifyRequest, FastifyReply } from 'fastify'
import { newsletterService } from '../services/newsletter.service'
import { successResponse } from '../utils/response'

export const newsletterController = {
  async listSubscribers(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; activeOnly?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await newsletterService.listSubscribers({
      page: Number(request.query.page) || 1,
      limit: Math.min(Number(request.query.limit) || 50, 200),
      activeOnly: request.query.activeOnly === 'true',
    })
    return reply.send(successResponse(result))
  },

  async exportCsv(
    request: FastifyRequest<{ Querystring: { activeOnly?: string } }>,
    reply: FastifyReply,
  ) {
    const csv = await newsletterService.exportSubscribersCsv(
      request.query.activeOnly !== 'false',
    )
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"')
      .send(csv)
  },

  async deactivateSubscriber(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    await newsletterService.deactivateSubscriber(request.params.id)
    return reply.send(successResponse({ message: 'Subscriber deactivated' }))
  },

  async deleteSubscriber(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    await newsletterService.deleteSubscriber(request.params.id)
    return reply.send(successResponse({ deleted: true }))
  },
}
