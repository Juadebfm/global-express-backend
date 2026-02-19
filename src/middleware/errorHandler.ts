import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../config/env'

/**
 * Centralized Fastify error handler.
 * - Never leaks stack traces in production.
 * - Normalises all error shapes to { success: false, message, errors? }.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const isProduction = env.NODE_ENV === 'production'

  request.log.error(
    {
      err: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        // Only include stack in non-production logs
        ...(isProduction ? {} : { stack: error.stack }),
      },
      requestId: request.id,
      method: request.method,
      url: request.url,
    },
    'Request error',
  )

  // Fastify schema validation errors (400)
  if (error.statusCode === 400 && error.validation) {
    reply.code(400).send({
      success: false,
      message: 'Validation failed',
      errors: error.validation,
    })
    return
  }

  const statusCode = error.statusCode ?? 500
  const message =
    isProduction && statusCode === 500 ? 'Internal server error' : error.message

  reply.code(statusCode).send({ success: false, message })
}
