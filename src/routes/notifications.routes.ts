import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { notificationsController } from '../controllers/notifications.controller'
import { authenticate } from '../middleware/authenticate'
import { requireSuperAdmin } from '../middleware/requireRole'

const notificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  orderId: z.string().uuid().nullable(),
  type: z.enum(['order_status_update', 'payment_event', 'system_announcement', 'admin_alert']),
  title: z.string(),
  subtitle: z.string().nullable(),
  body: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  isBroadcast: z.boolean(),
  isRead: z.boolean(),
  isSaved: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
})

const paginatedNotificationsSchema = z.object({
  data: z.array(notificationSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
})

export async function notificationsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // GET /notifications — user inbox (personal + broadcasts)
  app.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Get notification inbox (personal + broadcasts)',
      description: `Returns paginated notifications for the authenticated user.

Includes:
- **Personal notifications**: order status updates, payment events, admin alerts addressed to this user.
- **Broadcast notifications**: system-wide announcements visible to all users.

**isRead / isSaved** reflect this user's state for each notification.`,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: paginatedNotificationsSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: notificationsController.list,
  })

  // GET /notifications/unread-count
  app.get('/unread-count', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Get unread notification count',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ count: z.number() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: notificationsController.unreadCount,
  })

  // PATCH /notifications/:id/read — mark a notification as read
  app.patch('/:id/read', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Mark a notification as read',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: notificationsController.markRead,
  })

  // PATCH /notifications/:id/save — toggle saved state
  app.patch('/:id/save', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Toggle saved state on a notification',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: notificationsController.toggleSaved,
  })

  // DELETE /notifications/:id — delete a single notification
  app.delete('/:id', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Delete a notification',
      description: `Removes a notification from the user's inbox.

- **Personal notifications** are permanently deleted.
- **Broadcast notifications** are hidden only for this user — other users are not affected.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ message: z.string() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: notificationsController.deleteOne,
  })

  // DELETE /notifications — bulk delete
  app.delete('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Notifications'],
      summary: 'Bulk delete notifications',
      description: `Deletes multiple notifications by ID. Personal notifications are permanently deleted; broadcasts are hidden for this user only.

Returns the count of successfully processed items. IDs that do not belong to the user are silently skipped.`,
      security: [{ bearerAuth: [] }],
      body: z.object({
        ids: z.array(z.string().uuid()).min(1).max(100).describe('Array of notification UUIDs to delete (max 100)'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ deleted: z.number() }) }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: notificationsController.bulkDelete,
  })

  // POST /notifications/broadcast — superadmin only
  app.post('/broadcast', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Notifications'],
      summary: 'Send a system-wide broadcast notification (superadmin)',
      description: `Creates a system-wide notification visible to all users and pushes it in real-time via WebSocket.

**Types allowed for broadcasts:** \`system_announcement\`, \`admin_alert\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        type: z.enum(['system_announcement', 'admin_alert']).describe('Broadcast type'),
        title: z.string().min(1).describe('Notification title'),
        subtitle: z.string().optional().describe('Short summary line (optional)'),
        body: z.string().min(1).describe('Full notification message'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Optional structured payload'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: notificationSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: notificationsController.broadcast,
  })
}
