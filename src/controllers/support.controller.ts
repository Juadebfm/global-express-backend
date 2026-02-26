import type { FastifyRequest, FastifyReply } from 'fastify'
import { supportService } from '../services/support.service'
import { successResponse } from '../utils/response'

export const supportController = {
  async create(
    request: FastifyRequest<{
      Body: {
        subject: string
        category: string
        body: string
        orderId?: string
        forUserId?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const result = await supportService.createTicket(
      {
        subject: request.body.subject,
        category: request.body.category as never,
        body: request.body.body,
        orderId: request.body.orderId,
        forUserId: request.body.forUserId,
      },
      { id: request.user.id, role: request.user.role },
    )
    return reply.code(201).send(successResponse(result))
  },

  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string
        limit?: string
        status?: string
        category?: string
        assignedTo?: string
        userId?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const result = await supportService.listTickets(
      {
        page: Number(request.query.page) || 1,
        limit: Number(request.query.limit) || 20,
        status: request.query.status as never,
        category: request.query.category as never,
        assignedTo: request.query.assignedTo,
        userId: request.query.userId,
      },
      { id: request.user.id, role: request.user.role },
    )
    return reply.send(successResponse(result))
  },

  async getOne(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const result = await supportService.getTicket(request.params.id, {
      id: request.user.id,
      role: request.user.role,
    })
    if (!result) return reply.code(404).send({ success: false, message: 'Ticket not found' })
    if (result === 'forbidden') return reply.code(403).send({ success: false, message: 'Forbidden' })
    return reply.send(successResponse(result))
  },

  async addMessage(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { body: string; isInternal?: boolean }
    }>,
    reply: FastifyReply,
  ) {
    const result = await supportService.createMessage(
      request.params.id,
      { body: request.body.body, isInternal: request.body.isInternal },
      { id: request.user.id, role: request.user.role },
    )
    if (!result) return reply.code(404).send({ success: false, message: 'Ticket not found' })
    if (result === 'forbidden') return reply.code(403).send({ success: false, message: 'Forbidden' })
    if (result === 'closed') return reply.code(422).send({ success: false, message: 'Cannot message a closed ticket' })
    return reply.code(201).send(successResponse(result))
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { status?: string; assignedTo?: string | null }
    }>,
    reply: FastifyReply,
  ) {
    const result = await supportService.updateTicket(
      request.params.id,
      {
        status: request.body.status as never,
        assignedTo: request.body.assignedTo,
      },
      { id: request.user.id, role: request.user.role },
    )
    if (!result) return reply.code(404).send({ success: false, message: 'Ticket not found' })
    if (result === 'forbidden') return reply.code(403).send({ success: false, message: 'Forbidden' })
    return reply.send(successResponse(result))
  },
}
