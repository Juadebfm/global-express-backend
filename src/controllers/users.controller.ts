import type { FastifyRequest, FastifyReply } from 'fastify'
import { usersService } from '../services/users.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import type { UserRole } from '../types/enums'
import type { PaginationParams } from '../types'

export const usersController = {
  async getMe(request: FastifyRequest, reply: FastifyReply) {
    const user = await usersService.getUserById(request.user.id)

    if (!user) {
      return reply.code(404).send({ success: false, message: 'User not found' })
    }

    return reply.send(successResponse(user))
  },

  async updateMe(
    request: FastifyRequest<{
      Body: {
        firstName?: string
        lastName?: string
        phone?: string | null
        consentMarketing?: boolean
      }
    }>,
    reply: FastifyReply,
  ) {
    const updated = await usersService.updateUser(request.user.id, request.body)

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'User not found' })
    }

    return reply.send(successResponse(updated))
  },

  async deleteMe(request: FastifyRequest, reply: FastifyReply) {
    // GDPR: soft delete — data is retained per retention policy but marked as deleted
    const deleted = await usersService.softDeleteUser(request.user.id)

    if (!deleted) {
      return reply.code(404).send({ success: false, message: 'User not found' })
    }

    return reply.send(successResponse({ message: 'Account deleted successfully' }))
  },

  async exportMyData(request: FastifyRequest, reply: FastifyReply) {
    // GDPR: user can export all their personal data
    const data = await usersService.exportUserData(request.user.id)
    return reply.send(successResponse(data))
  },

  async listUsers(
    request: FastifyRequest<{
      Querystring: PaginationParams & { role?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await usersService.listUsers({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      role: request.query.role as UserRole | undefined,
    })

    return reply.send(successResponse(result))
  },

  async getUserById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const user = await usersService.getUserById(request.params.id)

    if (!user) {
      return reply.code(404).send({ success: false, message: 'User not found' })
    }

    return reply.send(successResponse(user))
  },

  async updateUser(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { firstName?: string; lastName?: string; phone?: string | null; isActive?: boolean }
    }>,
    reply: FastifyReply,
  ) {
    const updated = await usersService.updateUser(request.params.id, request.body)

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'User not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Updated user ${request.params.id}`,
      resourceType: 'user',
      resourceId: request.params.id,
      request,
    })

    return reply.send(successResponse(updated))
  },

  async updateUserRole(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { role: UserRole }
    }>,
    reply: FastifyReply,
  ) {
    const updated = await usersService.updateUserRole(request.params.id, request.body.role)

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'User not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Changed role of user ${request.params.id} to ${request.body.role}`,
      resourceType: 'user',
      resourceId: request.params.id,
      request,
      metadata: { newRole: request.body.role },
    })

    return reply.send(successResponse(updated))
  },

  async deleteUser(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const deleted = await usersService.softDeleteUser(request.params.id)

    if (!deleted) {
      return reply.code(404).send({ success: false, message: 'User not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Soft-deleted user ${request.params.id}`,
      resourceType: 'user',
      resourceId: request.params.id,
      request,
    })

    return reply.send(successResponse({ message: 'User deleted successfully' }))
  },
}
