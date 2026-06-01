import type { FastifyReply } from 'fastify'

/**
 * Marks an endpoint as deprecated per RFC 9745 (`Deprecation`) and RFC 8594
 * (`Sunset`).
 *
 *   markDeprecated(reply, {
 *     // ISO 8601 — when the endpoint started being deprecated.
 *     deprecatedSince: '2026-06-01',
 *     // When the endpoint will be removed.
 *     sunsetAt: '2027-01-01',
 *     // Where clients should go.
 *     successorUrl: 'https://api.globalexpress.kr/api/v2/orders',
 *   })
 *
 * Apply via `onSend` hook on the route's schema config or directly in the
 * handler. The Link header uses rel="sunset" per RFC 8594 § 5.
 */
export interface DeprecationOptions {
  /** ISO date string (YYYY-MM-DD) when the endpoint was marked deprecated. */
  deprecatedSince: string
  /** ISO date string (YYYY-MM-DD) when the endpoint will be removed. */
  sunsetAt: string
  /** Optional successor URL for the Link rel="successor-version" header. */
  successorUrl?: string
  /** Optional URL pointing at documentation/changelog explaining the deprecation. */
  deprecationDocUrl?: string
}

function toRfc7231(dateIso: string): string {
  // Convert YYYY-MM-DD or full ISO to RFC 7231 IMF-fixdate as required by RFC 8594.
  return new Date(dateIso).toUTCString()
}

export function markDeprecated(reply: FastifyReply, opts: DeprecationOptions): void {
  reply.header('Deprecation', toRfc7231(opts.deprecatedSince))
  reply.header('Sunset', toRfc7231(opts.sunsetAt))

  const linkParts: string[] = []
  if (opts.successorUrl) linkParts.push(`<${opts.successorUrl}>; rel="successor-version"`)
  if (opts.deprecationDocUrl) linkParts.push(`<${opts.deprecationDocUrl}>; rel="deprecation"`)
  if (linkParts.length > 0) reply.header('Link', linkParts.join(', '))
}

/**
 * Convenience preHandler factory — apply to deprecated routes:
 *
 *   app.get('/legacy-thing', {
 *     preHandler: [deprecationPreHandler({
 *       deprecatedSince: '2026-06-01',
 *       sunsetAt: '2027-01-01',
 *       successorUrl: 'https://api.example.com/v2/thing',
 *     })],
 *     handler: ...
 *   })
 */
export function deprecationPreHandler(opts: DeprecationOptions) {
  return async (_request: unknown, reply: FastifyReply): Promise<void> => {
    markDeprecated(reply, opts)
  }
}
