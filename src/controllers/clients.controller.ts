import type { FastifyRequest, FastifyReply } from 'fastify'
import { clientsService } from '../services/clients.service'
import { ordersService } from '../services/orders.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import type { ShipmentStatusV2 } from '../types/enums'

export const clientsController = {
  async list(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; isActive?: string }
    }>,
    reply: FastifyReply,
  ) {
    const isActive =
      request.query.isActive === 'true'
        ? true
        : request.query.isActive === 'false'
          ? false
          : undefined

    const result = await clientsService.listClients({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      isActive,
    })

    return reply.send(successResponse(result))
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }
    return reply.send(successResponse(client))
  },

  async listOrders(
    request: FastifyRequest<{
      Params: { id: string }
      Querystring: { page?: string; limit?: string; statusV2?: string }
    }>,
    reply: FastifyReply,
  ) {
    // Verify client exists
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    const result = await ordersService.listOrders({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      senderId: request.params.id,
      statusV2: request.query.statusV2 as ShipmentStatusV2 | undefined,
    })

    return reply.send(successResponse(result))
  },

  async createClient(
    request: FastifyRequest<{
      Body: {
        email: string
        firstName?: string
        lastName?: string
        businessName?: string
        phone?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const stub = await clientsService.createClientStub({
      email: request.body.email,
      firstName: request.body.firstName,
      lastName: request.body.lastName,
      businessName: request.body.businessName,
      phone: request.body.phone,
    })

    // Send Clerk invite — let errors surface (e.g. email already has a Clerk account)
    await clientsService.sendClerkInvite(request.body.email)

    await createAuditLog({
      userId: request.user.id,
      action: `Created client stub and sent Clerk invite to ${request.body.email}`,
      resourceType: 'user',
      resourceId: stub.id,
      request,
    })

    return reply.code(201).send(successResponse({ id: stub.id, email: request.body.email }))
  },

  async sendInvite(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    await clientsService.sendClerkInvite(client.email)

    await createAuditLog({
      userId: request.user.id,
      action: `Re-sent Clerk invite to client ${request.params.id}`,
      resourceType: 'user',
      resourceId: request.params.id,
      request,
    })

    return reply.send(successResponse({ message: 'Invite sent successfully' }))
  },
}
