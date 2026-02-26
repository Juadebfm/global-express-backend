import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../config/db'
import { supportTickets, supportMessages, users } from '../../drizzle/schema'
import { decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { notifyUser } from './notifications.service'
import { broadcastToTicket, broadcastToAll, ticketRooms } from '../websocket/handlers'
import { UserRole } from '../types/enums'
import type { PaginationParams } from '../types'

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketCategory =
  | 'shipment_inquiry'
  | 'payment_issue'
  | 'damaged_goods'
  | 'document_request'
  | 'account_issue'
  | 'general'

export interface CreateTicketInput {
  subject: string
  category: TicketCategory
  body: string
  orderId?: string
  forUserId?: string // staff creating on behalf of a customer
}

export interface CreateMessageInput {
  body: string
  isInternal?: boolean
}

export interface UpdateTicketInput {
  status?: TicketStatus
  assignedTo?: string | null
}

export interface ListTicketsParams extends PaginationParams {
  status?: TicketStatus
  category?: TicketCategory
  assignedTo?: string
  userId?: string // staff filter by customer
}

export interface RequestingUser {
  id: string
  role: string
}

const STAFF_ROLES = [UserRole.STAFF, UserRole.ADMIN, UserRole.SUPERADMIN] as string[]

function isStaff(role: string): boolean {
  return STAFF_ROLES.includes(role)
}

function isAdminOrAbove(role: string): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPERADMIN
}

async function generateTicketNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportTickets)
  return `TKT-${String(count + 1).padStart(4, '0')}`
}

function formatAuthorName(
  firstName: string | null,
  lastName: string | null,
  businessName: string | null,
): string | null {
  try {
    const first = firstName ? decrypt(firstName) : null
    const last = lastName ? decrypt(lastName) : null
    const biz = businessName ? decrypt(businessName) : null
    if (first && last) return `${first} ${last}`
    if (first) return first
    if (biz) return biz
    return null
  } catch {
    return null
  }
}

function formatTicket(row: typeof supportTickets.$inferSelect) {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    userId: row.userId,
    orderId: row.orderId ?? null,
    category: row.category,
    status: row.status,
    subject: row.subject,
    assignedTo: row.assignedTo ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const supportService = {
  async createTicket(input: CreateTicketInput, requestingUser: RequestingUser) {
    const targetUserId =
      isStaff(requestingUser.role) && input.forUserId
        ? input.forUserId
        : requestingUser.id

    const ticketNumber = await generateTicketNumber()

    const [ticket] = await db
      .insert(supportTickets)
      .values({
        ticketNumber,
        userId: targetUserId,
        orderId: input.orderId ?? null,
        category: input.category,
        status: 'open',
        subject: input.subject,
      })
      .returning()

    const [message] = await db
      .insert(supportMessages)
      .values({
        ticketId: ticket.id,
        authorId: requestingUser.id,
        body: input.body,
        isInternal: false,
      })
      .returning()

    const formatted = formatTicket(ticket)

    // Notify all connected staff that a new ticket has arrived
    broadcastToAll({ type: 'support:new_ticket', data: formatted })

    return { ticket: formatted, message: await this._formatMessage(message) }
  },

  async listTickets(params: ListTicketsParams, requestingUser: RequestingUser) {
    const offset = getPaginationOffset(params.page, params.limit)

    const conditions = []

    // Customers only see their own tickets
    if (!isStaff(requestingUser.role)) {
      conditions.push(eq(supportTickets.userId, requestingUser.id))
    } else if (params.userId) {
      conditions.push(eq(supportTickets.userId, params.userId))
    }

    if (params.status) conditions.push(eq(supportTickets.status, params.status))
    if (params.category) conditions.push(eq(supportTickets.category, params.category))
    if (params.assignedTo) conditions.push(eq(supportTickets.assignedTo, params.assignedTo))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(supportTickets)
        .where(where)
        .orderBy(desc(supportTickets.updatedAt))
        .limit(params.limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(supportTickets).where(where),
    ])

    return buildPaginatedResult(rows.map(formatTicket), countResult[0]?.count ?? 0, params)
  },

  async getTicket(ticketId: string, requestingUser: RequestingUser) {
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1)

    if (!ticket) return null

    // Customers can only view their own tickets
    if (!isStaff(requestingUser.role) && ticket.userId !== requestingUser.id) {
      return 'forbidden' as const
    }

    // Fetch messages, joining author name
    const messages = await db
      .select({
        id: supportMessages.id,
        ticketId: supportMessages.ticketId,
        authorId: supportMessages.authorId,
        body: supportMessages.body,
        isInternal: supportMessages.isInternal,
        createdAt: supportMessages.createdAt,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorBusinessName: users.businessName,
      })
      .from(supportMessages)
      .leftJoin(users, eq(users.id, supportMessages.authorId))
      .where(
        and(
          eq(supportMessages.ticketId, ticketId),
          // Customers never see internal notes
          isStaff(requestingUser.role) ? undefined : eq(supportMessages.isInternal, false),
        ),
      )
      .orderBy(supportMessages.createdAt)

    return {
      ticket: formatTicket(ticket),
      messages: messages.map((m) => ({
        id: m.id,
        ticketId: m.ticketId,
        authorId: m.authorId,
        authorName: formatAuthorName(m.authorFirstName, m.authorLastName, m.authorBusinessName),
        body: m.body,
        isInternal: m.isInternal,
        createdAt: m.createdAt.toISOString(),
      })),
    }
  },

  async createMessage(
    ticketId: string,
    input: CreateMessageInput,
    requestingUser: RequestingUser,
  ) {
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1)

    if (!ticket) return null

    // Customers can only message their own tickets
    if (!isStaff(requestingUser.role) && ticket.userId !== requestingUser.id) {
      return 'forbidden' as const
    }

    // Nobody can message a closed ticket
    if (ticket.status === 'closed') return 'closed' as const

    // Only staff can post internal notes
    const isInternal = isStaff(requestingUser.role) ? (input.isInternal ?? false) : false

    const [message] = await db
      .insert(supportMessages)
      .values({
        ticketId,
        authorId: requestingUser.id,
        body: input.body,
        isInternal,
      })
      .returning()

    // Auto-advance: if ticket was 'open' and a staff member replied, move to 'in_progress'
    if (ticket.status === 'open' && isStaff(requestingUser.role)) {
      await db
        .update(supportTickets)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId))
    } else {
      await db
        .update(supportTickets)
        .set({ updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId))
    }

    // Get author name for the broadcast payload
    const [author] = await db
      .select({ firstName: users.firstName, lastName: users.lastName, businessName: users.businessName })
      .from(users)
      .where(eq(users.id, requestingUser.id))
      .limit(1)

    const formatted = {
      id: message.id,
      ticketId: message.ticketId,
      authorId: message.authorId,
      authorName: author
        ? formatAuthorName(author.firstName, author.lastName, author.businessName)
        : null,
      body: message.body,
      isInternal: message.isInternal,
      createdAt: message.createdAt.toISOString(),
    }

    // Broadcast to everyone watching this ticket room
    broadcastToTicket(ticketId, { type: 'support:message', data: { ticketId, message: formatted } })

    // If staff replied and the customer is not currently in the ticket room, send a notification
    if (isStaff(requestingUser.role) && !isInternal) {
      const roomUsers = ticketRooms.get(ticketId)
      const customerInRoom = roomUsers?.has(ticket.userId) ?? false
      if (!customerInRoom) {
        notifyUser({
          userId: ticket.userId,
          orderId: ticket.orderId ?? undefined,
          type: 'order_status_update',
          title: 'Support reply',
          subtitle: ticket.ticketNumber,
          body: input.body.slice(0, 100),
          createdBy: requestingUser.id,
        }).catch(() => {})
      }
    }

    return formatted
  },

  async updateTicket(
    ticketId: string,
    input: UpdateTicketInput,
    requestingUser: RequestingUser,
  ) {
    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1)

    if (!ticket) return null

    const patch: Partial<typeof supportTickets.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (input.status !== undefined) {
      // Admin+ can set any status; staff can set all except 'closed'
      if (input.status === 'closed' && !isAdminOrAbove(requestingUser.role)) {
        return 'forbidden' as const
      }
      patch.status = input.status
      patch.closedAt = input.status === 'closed' ? new Date() : null
    }

    if (input.assignedTo !== undefined) {
      if (!isAdminOrAbove(requestingUser.role)) return 'forbidden' as const
      patch.assignedTo = input.assignedTo
    }

    const [updated] = await db
      .update(supportTickets)
      .set(patch)
      .where(eq(supportTickets.id, ticketId))
      .returning()

    // Notify the customer if status changed to resolved
    if (input.status === 'resolved') {
      notifyUser({
        userId: ticket.userId,
        orderId: ticket.orderId ?? undefined,
        type: 'order_status_update',
        title: 'Support ticket resolved',
        subtitle: ticket.ticketNumber,
        body: 'Your support ticket has been marked as resolved. Reply to reopen it.',
        createdBy: requestingUser.id,
      }).catch(() => {})
    }

    return formatTicket(updated)
  },

  async _formatMessage(message: typeof supportMessages.$inferSelect) {
    const [author] = await db
      .select({ firstName: users.firstName, lastName: users.lastName, businessName: users.businessName })
      .from(users)
      .where(eq(users.id, message.authorId))
      .limit(1)

    return {
      id: message.id,
      ticketId: message.ticketId,
      authorId: message.authorId,
      authorName: author
        ? formatAuthorName(author.firstName, author.lastName, author.businessName)
        : null,
      body: message.body,
      isInternal: message.isInternal,
      createdAt: message.createdAt.toISOString(),
    }
  },
}
