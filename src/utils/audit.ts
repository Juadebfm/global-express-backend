import type { FastifyRequest } from 'fastify'
import { db } from '../config/db'
import { auditLogs } from '../../drizzle/schema'

interface CreateAuditLogParams {
  userId: string
  action: string
  resourceType: string
  resourceId?: string
  request: FastifyRequest
  metadata?: Record<string, unknown>
}

/**
 * Persists an audit log entry for admin/superadmin actions.
 * Audit logs are immutable — never expose a delete endpoint for them.
 */
export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  const { userId, action, resourceType, resourceId, request, metadata } = params

  await db.insert(auditLogs).values({
    userId,
    action,
    resourceType,
    resourceId: resourceId ?? null,
    // Never log PII here — only IP and user-agent for audit trail
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
    metadata: metadata ?? null,
  })
}
