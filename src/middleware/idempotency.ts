import type { FastifyRequest, FastifyReply } from 'fastify'
import { createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { idempotencyKeys } from '../../drizzle/schema'

/**
 * Idempotency-Key middleware (REST best practice; follows Stripe's convention).
 *
 * On a write request with `Idempotency-Key: <client-uuid>` header:
 *   - First request: pass through. The onSend hook persists the response body +
 *     status against the key, scoped to the (user, method, path, request-hash).
 *   - Subsequent requests with the same key + matching request: return the
 *     cached response instead of re-executing the handler. The reply carries
 *     `Idempotent-Replayed: true`.
 *   - Subsequent requests with the same key but a DIFFERENT request: 422.
 *
 * Entries live for 24h (TTL covers retry windows for network failures and
 * client-side queue replays).
 */

const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

const KEY_REGEX = /^[A-Za-z0-9_-]{8,255}$/

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string
    idempotencyRequestHash?: string
    idempotencyCapturedPayload?: unknown
    idempotencyCapturedStatus?: number
  }
}

function hashRequest(req: FastifyRequest): string {
  const body = req.body ? JSON.stringify(req.body) : ''
  return createHash('sha256')
    .update(`${req.method}\n${req.url}\n${body}`)
    .digest('hex')
}

/**
 * preHandler — checks for a cached response. If found and matching, sends it
 * immediately. If the same key is reused with a different request body, returns 422.
 */
export async function checkIdempotencyKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const headerVal = request.headers['idempotency-key']
  const key = Array.isArray(headerVal) ? headerVal[0] : headerVal
  if (!key) return // no key supplied — middleware no-ops

  if (!KEY_REGEX.test(key)) {
    reply.code(400).send({
      success: false,
      message: 'Idempotency-Key must be 8–255 chars and match [A-Za-z0-9_-]',
    })
    return
  }

  const requestHash = hashRequest(request)
  request.idempotencyKey = key
  request.idempotencyRequestHash = requestHash

  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1)

  if (!existing) return // first time we've seen this key

  if (existing.expiresAt < new Date()) {
    // Expired — let the new request proceed and the onSend hook will overwrite.
    return
  }

  if (existing.requestHash !== requestHash) {
    reply.code(422).send({
      success: false,
      message:
        'Idempotency-Key has already been used with a different request. Use a new key for a different operation.',
    })
    return
  }

  reply.header('Idempotent-Replayed', 'true')
  reply.code(existing.statusCode).send(existing.responseBody)
}

/**
 * onSend (sync) — captures the response payload + status code so the
 * onResponse hook can persist it AFTER the response has been written.
 * Doing the DB insert in onResponse keeps the response latency unaffected.
 */
export function captureIdempotencyResult(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): unknown {
  if (!request.idempotencyKey || !request.idempotencyRequestHash) return payload
  if (reply.statusCode >= 400) return payload
  if (reply.getHeader('Idempotent-Replayed') === 'true') return payload

  request.idempotencyCapturedPayload = payload
  request.idempotencyCapturedStatus = reply.statusCode
  return payload
}

/**
 * onResponse — persists the captured response body + status against the key.
 * Fires AFTER the client has received the response, so the DB write does not
 * extend response latency.
 */
export async function persistIdempotencyResult(
  request: FastifyRequest,
): Promise<void> {
  const key = request.idempotencyKey
  const requestHash = request.idempotencyRequestHash
  const payload = request.idempotencyCapturedPayload
  const statusCode = request.idempotencyCapturedStatus
  if (!key || !requestHash || statusCode === undefined) return

  let bodyJson: unknown
  if (typeof payload === 'string') {
    try {
      bodyJson = JSON.parse(payload)
    } catch {
      bodyJson = payload
    }
  } else {
    bodyJson = payload
  }

  const userId = request.user?.id ?? null

  try {
    await db
      .insert(idempotencyKeys)
      .values({
        key,
        userId,
        method: request.method,
        path: request.url,
        requestHash,
        statusCode,
        responseBody: bodyJson,
        expiresAt: new Date(Date.now() + TTL_MS),
      })
      .onConflictDoNothing()
  } catch (err) {
    request.log.warn({ err, key }, 'Failed to persist idempotency key')
  }
}
