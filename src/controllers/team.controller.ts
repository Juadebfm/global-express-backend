import type { FastifyRequest, FastifyReply } from 'fastify'
import { teamService } from '../services/team.service'
import { successResponse } from '../utils/response'

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
}
