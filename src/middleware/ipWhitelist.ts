import type { FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../config/env'

// Parse once at startup — list is stable for the lifetime of the process
const WHITELISTED_IPS = new Set(env.ADMIN_IP_WHITELIST.split(',').map((ip) => ip.trim()))

/**
 * Blocks requests to admin/superadmin routes from non-whitelisted IPs.
 * IP whitelist is configured via the ADMIN_IP_WHITELIST environment variable.
 *
 * Must be used as a preHandler on all admin and superadmin routes.
 */
export async function ipWhitelist(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const clientIp = request.ip

  if (!WHITELISTED_IPS.has(clientIp)) {
    request.log.warn({ ip: clientIp, path: request.url }, 'Blocked non-whitelisted IP on admin route')
    reply.code(403).send({
      success: false,
      message: 'Forbidden — access is not permitted from this IP address',
    })
  }
}
