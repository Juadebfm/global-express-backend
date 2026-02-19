import type { FastifyRequest, FastifyReply } from 'fastify'
import { UserRole } from '../types/enums'

type RolePreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

/**
 * Factory that returns a preHandler enforcing that `request.user.role` is one of the
 * allowed roles. Must be used **after** the `authenticate` middleware.
 *
 * Role guards live exclusively at middleware level — never inside controllers or services.
 */
export function requireRole(...allowedRoles: UserRole[]): RolePreHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userRole = request.user?.role as UserRole

    if (!userRole || !allowedRoles.includes(userRole)) {
      reply.code(403).send({
        success: false,
        message: 'Forbidden — you do not have permission to access this resource',
      })
    }
  }
}

// Convenience guards
export const requireSuperAdmin = requireRole(UserRole.SUPERADMIN)

export const requireAdminOrAbove = requireRole(UserRole.SUPERADMIN, UserRole.ADMIN)

export const requireStaffOrAbove = requireRole(
  UserRole.SUPERADMIN,
  UserRole.ADMIN,
  UserRole.STAFF,
)
