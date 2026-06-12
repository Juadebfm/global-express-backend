import type { FastifyRequest, FastifyReply } from 'fastify'

import { teamService } from '../services/team.service'
import { successResponse } from '../utils/response'
import { createAuditLog } from '../utils/audit'

export const teamController = {
  async list(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; role?: string; isActive?: string }
    }>,
    reply: FastifyReply,
  ) {
    const isActive =
      request.query.isActive === 'true'
        ? true
        : request.query.isActive === 'false'
          ? false
          : undefined

    const result = await teamService.listTeam({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      role: request.query.role,
      isActive,
    })

    return reply.send(successResponse(result))
  },

  async approve(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const member = await teamService.approveTeamMember(request.params.id)
    if (!member) {
      return reply.code(404).send({ success: false, message: 'Team member not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: 'team_member_approved',
      resourceType: 'user',
      resourceId: member.id,
      request,
    })

    return reply.send(successResponse(member))
  },
}
