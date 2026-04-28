import type { FastifyRequest, FastifyReply } from 'fastify'
import { notificationsService } from '../services/notifications.service'
import { successResponse } from '../utils/response'
import type { NotificationType } from '../services/notifications.service'
import type { UserRole } from '../types/enums'

export const notificationsController = {
  async list(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await notificationsService.listForUser(
      request.user.id,
      request.user.role as UserRole,
      {
        page: Number(request.query.page) || 1,
        limit: Number(request.query.limit) || 20,
      },
    )
    return reply.send(successResponse(result))
  },

  async unreadCount(request: FastifyRequest, reply: FastifyReply) {
    const count = await notificationsService.getUnreadCount(
      request.user.id,
      request.user.role as UserRole,
    )
    return reply.send(successResponse({ count }))
  },

  async markAllRead(request: FastifyRequest, reply: FastifyReply) {
    await notificationsService.markAllRead(request.user.id, request.user.role as UserRole)
    return reply.send(successResponse({ message: 'All notifications marked as read' }))
  },

  async markRead(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const ok = await notificationsService.markRead(
      request.params.id,
      request.user.id,
      request.user.role as UserRole,
    )
    if (!ok) {
      return reply.code(404).send({ success: false, message: 'Notification not found or not accessible' })
    }
    return reply.send(successResponse({ message: 'Marked as read' }))
  },

  async toggleSaved(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const ok = await notificationsService.toggleSaved(
      request.params.id,
      request.user.id,
      request.user.role as UserRole,
    )
    if (!ok) {
      return reply.code(404).send({ success: false, message: 'Notification not found or not accessible' })
    }
    return reply.send(successResponse({ message: 'Saved state toggled' }))
  },

  async deleteOne(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const ok = await notificationsService.deleteNotification(
      request.params.id,
      request.user.id,
      request.user.role as UserRole,
    )
    if (!ok) {
      return reply.code(404).send({ success: false, message: 'Notification not found or not accessible' })
    }
    return reply.send(successResponse({ message: 'Notification deleted' }))
  },

  async bulkDelete(
    request: FastifyRequest<{ Body: { ids: string[] } }>,
    reply: FastifyReply,
  ) {
    const deleted = await notificationsService.bulkDeleteNotifications(
      request.body.ids,
      request.user.id,
      request.user.role as UserRole,
    )
    return reply.send(successResponse({ deleted }))
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
