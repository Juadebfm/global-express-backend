import type { FastifyRequest, FastifyReply } from 'fastify'
import { UserRole } from '../types/enums'
import { createAuditLog } from '../utils/audit'
import { logSecurityEvent } from '../utils/security-events'

type RolePreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

/**
 * Factory that returns a preHandler enforcing that `request.user.role` is one of the
 * allowed roles. Must be used **after** the `authenticate` middleware.
 *
 * Role guards live exclusively at middleware level — never inside controllers or services.
 * Denials are recorded in the audit log (fire-and-forget) for security review (ASVS 4.1.5).
 */
export function requireRole(...allowedRoles: UserRole[]): RolePreHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userRole = request.user?.role as UserRole

    if (!userRole || !allowedRoles.includes(userRole)) {
      const userId = request.user?.id
      if (userId) {
        createAuditLog({
          userId,
          action: 'access_denied',
          resourceType: 'route',
          request,
          metadata: {
            method: request.method,
            url: request.url,
            actualRole: userRole ?? null,
            allowedRoles,
          },
        }).catch(() => {
          // Never let audit failure block the 403 response.
        })
      }

      logSecurityEvent({
        type: 'permission_denied',
        request,
        userId: userId ?? null,
        metadata: {
          method: request.method,
          url: request.url,
          actualRole: userRole ?? null,
          allowedRoles,
        },
      })

      return reply.code(403).send({
        success: false,
        message: 'Forbidden — you do not have permission to access this resource',
      })
    }
  }
}

// Convenience guards
export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN)

export const requireAdminOrAbove = requireRole(UserRole.SUPER_ADMIN, UserRole.STAFF)

export const requireStaffOrAbove = requireRole(
  UserRole.SUPER_ADMIN,
  UserRole.STAFF,
)
