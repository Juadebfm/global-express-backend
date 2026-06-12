import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../config/env'
import {
  PROBLEM_CONTENT_TYPE,
  buildProblem,
  type ProblemDetails,
} from '../utils/problem-details'

/**
 * Centralized Fastify error handler — emits RFC 7807 Problem Details
 * (`application/problem+json`) on every error response.
 *
 * Never leaks stack traces in production. Always includes `requestId` so the
 * client can quote it when reporting issues.
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
        // Include the underlying cause (e.g. the raw PostgreSQL error from Neon/Drizzle)
        cause: error.cause
          ? {
              message: (error.cause as Error)?.message,
              code: (error.cause as Record<string, unknown>)?.code,
            }
          : undefined,
        ...(isProduction ? {} : { stack: error.stack }),
      },
      requestId: request.id,
      method: request.method,
      url: request.url,
    },
    'Request error',
  )

  // Zod / Fastify schema validation errors → 400 with per-field issues.
  if (error.statusCode === 400 && error.validation) {
    const problem = buildProblem({
      status: 400,
      detail: 'One or more request fields failed validation.',
      instance: request.url,
      requestId: request.id,
      errors: error.validation.map((v) => ({
        path: instancePathToSegments(v.instancePath ?? ''),
        message: v.message ?? 'Invalid',
        code: v.keyword,
      })),
    })
    sendProblem(reply, 400, problem)
    return
  }

  const statusCode = error.statusCode ?? 500
  const detail =
    isProduction && statusCode === 500 ? 'An internal error occurred.' : error.message

  const problem = buildProblem({
    status: statusCode,
    detail,
    instance: request.url,
    requestId: request.id,
  })

  sendProblem(reply, statusCode, problem)
}

function sendProblem(reply: FastifyReply, status: number, problem: ProblemDetails): void {
  reply
    .header('Content-Type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`)
    .code(status)
    .send(problem)
}

function instancePathToSegments(instancePath: string): (string | number)[] {
  if (!instancePath) return []
  return instancePath
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      const n = Number(seg)
      return Number.isFinite(n) && String(n) === seg ? n : seg
    })
}
