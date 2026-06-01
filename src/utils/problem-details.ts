import { z } from 'zod'

/**
 * RFC 7807 Problem Details for HTTP APIs.
 *
 *   https://datatracker.ietf.org/doc/html/rfc7807
 *
 * Standard fields:
 *   - type: URI reference identifying the problem type. We use a stable URN-style
 *           scheme (e.g. "about:blank" for generic, "/problems/validation").
 *   - title: short, human-readable summary (should not vary between instances).
 *   - status: HTTP status code.
 *   - detail: human-readable explanation specific to this occurrence.
 *   - instance: URI reference for the specific occurrence (we use the request URL).
 *
 * Extensions used in this API:
 *   - requestId: Fastify request id — clients should quote it when reporting issues.
 *   - errors: per-field validation issues (only on 400 from Zod validation).
 */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

const VALIDATION_ISSUE = z.object({
  path: z.array(z.union([z.string(), z.number()])).describe('JSON pointer-style path to the invalid value'),
  message: z.string(),
  code: z.string().optional(),
})

export const problemDetailsSchema = z
  .object({
    type: z.string().describe('URI reference identifying the problem type'),
    title: z.string().describe('Short, human-readable summary'),
    status: z.number().int().describe('HTTP status code'),
    detail: z.string().optional().describe('Explanation specific to this occurrence'),
    instance: z.string().optional().describe('URI of the specific occurrence (usually the request path)'),
    requestId: z.string().optional().describe('Fastify request id — quote when reporting issues'),
    errors: z.array(VALIDATION_ISSUE).optional().describe('Per-field validation issues'),
  })
  .describe('RFC 7807 Problem Details for HTTP APIs')

export type ProblemDetails = z.infer<typeof problemDetailsSchema>

/**
 * Map of well-known problem types in this API. Keep stable — these URIs are part
 * of the public API contract; clients may switch on them.
 */
export const PROBLEM_TYPES = {
  about_blank: 'about:blank',
  validation: '/problems/validation',
  unauthorized: '/problems/unauthorized',
  forbidden: '/problems/forbidden',
  not_found: '/problems/not-found',
  conflict: '/problems/conflict',
  unprocessable: '/problems/unprocessable',
  locked: '/problems/locked',
  rate_limited: '/problems/rate-limited',
  internal: '/problems/internal',
  service_unavailable: '/problems/service-unavailable',
} as const

const TITLE_BY_STATUS: Record<number, string> = {
  400: 'Validation failed',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  422: 'Unprocessable entity',
  423: 'Locked',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
}

const TYPE_BY_STATUS: Record<number, string> = {
  400: PROBLEM_TYPES.validation,
  401: PROBLEM_TYPES.unauthorized,
  403: PROBLEM_TYPES.forbidden,
  404: PROBLEM_TYPES.not_found,
  409: PROBLEM_TYPES.conflict,
  422: PROBLEM_TYPES.unprocessable,
  423: PROBLEM_TYPES.locked,
  429: PROBLEM_TYPES.rate_limited,
  500: PROBLEM_TYPES.internal,
  503: PROBLEM_TYPES.service_unavailable,
}

export function buildProblem(params: {
  status: number
  detail: string
  instance?: string
  requestId?: string
  type?: string
  title?: string
  errors?: ProblemDetails['errors']
  extensions?: Record<string, unknown>
}): ProblemDetails & Record<string, unknown> {
  const type = params.type ?? TYPE_BY_STATUS[params.status] ?? PROBLEM_TYPES.about_blank
  const title = params.title ?? TITLE_BY_STATUS[params.status] ?? 'Error'
  return {
    type,
    title,
    status: params.status,
    detail: params.detail,
    instance: params.instance,
    requestId: params.requestId,
    errors: params.errors,
    ...(params.extensions ?? {}),
  }
}

/**
 * Helper for route code — emit a Problem Details response from a Fastify reply.
 * Pulls `instance` and `requestId` from the request automatically.
 *
 *   sendProblem(reply, request, 404, 'Order not found')
 *   sendProblem(reply, request, 422, 'Invalid lane', { extensions: { laneId } })
 */
import type { FastifyReply, FastifyRequest } from 'fastify'

export function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  detail: string,
  options?: {
    type?: string
    title?: string
    extensions?: Record<string, unknown>
  },
): FastifyReply {
  const problem = buildProblem({
    status,
    detail,
    instance: request.url,
    requestId: request.id,
    type: options?.type,
    title: options?.title,
    extensions: options?.extensions,
  })
  return reply
    .header('Content-Type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`)
    .code(status)
    .send(problem)
}

/**
 * Type guard for the legacy `{ success: false, message }` shape.
 */
function isLegacyErrorPayload(
  value: unknown,
): value is { success: false; message: string; errors?: unknown; lockedUntil?: string } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.success === false && typeof v.message === 'string'
}

/**
 * Reshape a legacy error payload to RFC 7807 Problem Details. Preserves any
 * non-standard fields (e.g. `lockedUntil` from the login lockout response,
 * `errors` from validation responses) as Problem Details extensions.
 */
export function reshapeLegacyToProblem(
  payload: unknown,
  request: FastifyRequest,
  status: number,
): ProblemDetails & Record<string, unknown> {
  if (!isLegacyErrorPayload(payload)) {
    // Not a legacy shape — assume it's already Problem Details or pass through.
    return payload as ProblemDetails & Record<string, unknown>
  }

  const { message, ...rest } = payload
  const extensions: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (k === 'success') continue
    extensions[k] = v
  }

  return buildProblem({
    status,
    detail: message,
    instance: request.url,
    requestId: request.id,
    extensions,
  })
}
