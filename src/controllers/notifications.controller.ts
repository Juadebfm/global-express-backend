import type { FastifyRequest, FastifyReply } from 'fastify'
import { notificationsService } from '../services/notifications.service'
import { successResponse } from '../utils/response'
import type { NotificationType } from '../services/notifications.service'

export const notificationsController = {
  async list(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await notificationsService.listForUser(request.user.id, {
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
    })
    return reply.send(successResponse(result))
  },

  async unreadCount(request: FastifyRequest, reply: FastifyReply) {
    const count = await notificationsService.getUnreadCount(request.user.id)
    return reply.send(successResponse({ count }))
  },

  async markRead(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const ok = await notificationsService.markRead(request.params.id, request.user.id)
    if (!ok) {
      return reply.code(404).send({ success: false, message: 'Notification not found or not accessible' })
    }
    return reply.send(successResponse({ message: 'Marked as read' }))
  },

  async toggleSaved(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const ok = await notificationsService.toggleSaved(request.params.id, request.user.id)
    if (!ok) {
      return reply.code(404).send({ success: false, message: 'Notification not found or not accessible' })
    }
    return reply.send(successResponse({ message: 'Saved state toggled' }))
  },

  async broadcast(
    request: FastifyRequest<{
      Body: {
        type: NotificationType
        title: string
        subtitle?: string
        body: string
        metadata?: Record<string, unknown>
      }
    }>,
    reply: FastifyReply,
  ) {
    const notification = await notificationsService.createBroadcast({
      type: request.body.type,
      title: request.body.title,
      subtitle: request.body.subtitle,
      body: request.body.body,
      metadata: request.body.metadata,
      createdBy: request.user.id,
    })
    return reply.code(201).send(successResponse(notification))
  },
}
