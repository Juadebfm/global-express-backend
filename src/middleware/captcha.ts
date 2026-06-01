import type { FastifyRequest, FastifyReply } from 'fastify'
import { turnstileService } from '../services/turnstile.service'
import { sendProblem, PROBLEM_TYPES } from '../utils/problem-details'

/**
 * preHandler that enforces a Cloudflare Turnstile CAPTCHA on a public mutation
 * route. Apply to unauthenticated endpoints that create resources or contact
 * external services — newsletter, D2D intake, gallery claims, etc.
 *
 * The FE submits the token in the `cf-turnstile-response` header. We bind the
 * verification to the requester IP for additional risk scoring.
 *
 * If TURNSTILE_SECRET_KEY is not configured AND TURNSTILE_REQUIRE is unset
 * (typical dev), this middleware is a no-op — keeps local development friction
 * low. Production should always set the key.
 *
 * Returns RFC 7807 422 Unprocessable Entity on failure.
 */
export async function requireCaptcha(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!turnstileService.isEnabled()) return // dev bypass

  const headerVal = request.headers['cf-turnstile-response']
  const token = Array.isArray(headerVal) ? headerVal[0] : headerVal

  if (!token || token.length < 10) {
    sendProblem(reply, request, 422, 'CAPTCHA token is missing or malformed.', {
      type: PROBLEM_TYPES.unprocessable,
      title: 'CAPTCHA required',
      extensions: { code: 'captcha_missing' },
    })
    return
  }

  const ok = await turnstileService.verify(token, request.ip)
  if (!ok) {
    sendProblem(reply, request, 422, 'CAPTCHA verification failed. Refresh and try again.', {
      type: PROBLEM_TYPES.unprocessable,
      title: 'CAPTCHA failed',
      extensions: { code: 'captcha_failed' },
    })
    return
  }
}
