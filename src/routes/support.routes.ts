import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { supportController } from '../controllers/support.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove } from '../middleware/requireRole'

const ticketStatusEnum = z.enum(['open', 'in_progress', 'resolved', 'closed'])
const ticketCategoryEnum = z.enum([
  'shipment_inquiry',
  'payment_issue',
  'damaged_goods',
  'document_request',
  'account_issue',
  'general',
])

const ticketSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string().describe('Human-readable ticket ID, e.g. TKT-0001'),
  userId: z.string().uuid().describe('Customer who owns this ticket'),
  orderId: z.string().uuid().nullable(),
  category: ticketCategoryEnum,
  status: ticketStatusEnum,
  subject: z.string(),
  assignedTo: z.string().uuid().nullable().describe('Staff/admin assigned to this ticket'),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const messageSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  authorId: z.string().uuid(),
  authorName: z.string().nullable().describe('Decrypted display name of the author'),
  body: z.string(),
  isInternal: z.boolean().describe('Internal notes are only visible to staff/admin'),
  createdAt: z.string(),
})

export async function supportRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ─── POST /support/tickets — Create ticket ────────────────────────────────

  app.post('/tickets', {
    preHandler: [authenticate],
    schema: {
      tags: ['Support'],
      summary: 'Create a support ticket',
      description: `Opens a new support ticket with an opening message.

**Staff** can create tickets on behalf of any customer by providing \`forUserId\`.
**Customers** always create tickets for themselves.

Once created, all connected staff receive a \`support:new_ticket\` WebSocket event.`,
      security: [{ bearerAuth: [] }],
      body: z.object({
        subject: z.string().min(3).max(200).describe('One-line summary of the issue'),
        category: ticketCategoryEnum,
        body: z.string().min(1).max(5000).describe('Opening message body'),
        orderId: z.string().uuid().optional().describe('Link to a specific shipment (optional)'),
        forUserId: z
          .string()
          .uuid()
          .optional()
          .describe('Staff only — create ticket on behalf of this customer'),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({ ticket: ticketSchema, message: messageSchema }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: supportController.create,
  })

  // ─── GET /support/tickets — List tickets ──────────────────────────────────

  app.get('/tickets', {
    preHandler: [authenticate],
    schema: {
      tags: ['Support'],
      summary: 'List support tickets',
      description: `Returns a paginated list of support tickets.

**Customers** see only their own tickets.
**Staff+** see all tickets and can filter by \`status\`, \`category\`, \`assignedTo\`, or \`userId\` (customer filter).`,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
        status: ticketStatusEnum.optional(),
        category: ticketCategoryEnum.optional(),
        assignedTo: z.string().uuid().optional().describe('Filter by assigned staff member'),
        userId: z.string().uuid().optional().describe('Staff only — filter by customer'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(ticketSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: supportController.list,
  })

  // ─── GET /support/tickets/:id — Get ticket + thread ──────────────────────

  app.get('/tickets/:id', {
    preHandler: [authenticate],
    schema: {
      tags: ['Support'],
      summary: 'Get ticket with full message thread',
      description: `Returns the ticket and all messages in the conversation.

**Customers** cannot access tickets they do not own.
**Internal notes** (\`isInternal: true\`) are hidden from customers — only staff/admin see them.

**WebSocket room:** After fetching the ticket, the client should send \`{ type: "support:join", ticketId }\` to subscribe to real-time messages.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ ticket: ticketSchema, messages: z.array(messageSchema) }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: supportController.getOne,
  })

  // ─── POST /support/tickets/:id/messages — Send message ───────────────────

  app.post('/tickets/:id/messages', {
    preHandler: [authenticate],
    schema: {
      tags: ['Support'],
      summary: 'Send a message in a ticket conversation',
      description: `Adds a message to the ticket thread.

All users currently watching the ticket (via \`support:join\`) receive a \`support:message\` WebSocket event immediately.

If the customer is offline (not in the ticket room), they receive an in-app notification.

- **Customers** can only message their own tickets.
- **Staff** can set \`isInternal: true\` to post a private note invisible to the customer.
- Messaging a **closed** ticket returns 422.
- If the ticket was \`open\` and a staff member replies, status auto-advances to \`in_progress\`.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        body: z.string().min(1).max(5000),
        isInternal: z
          .boolean()
          .optional()
          .describe('Staff only — mark as internal note (hidden from customer)'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: messageSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
        422: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: supportController.addMessage,
  })

  // ─── PATCH /support/tickets/:id — Update status / assign ─────────────────

  app.patch('/tickets/:id', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Support'],
      summary: 'Update ticket status or assignment (staff+)',
      description: `Updates the ticket status and/or assigned operator.

**Status transitions:**
- Staff can set: \`open\`, \`in_progress\`, \`resolved\`
- Admin+ can also set: \`closed\` (permanent — customer cannot re-open a closed ticket)

**Assignment:** admin+ only. Pass \`assignedTo: null\` to unassign.

When resolved, the customer receives an in-app notification.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        status: ticketStatusEnum.optional(),
        assignedTo: z.string().uuid().nullable().optional().describe('Assign to a staff/admin user, or null to unassign'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: ticketSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: supportController.update,
  })
}
