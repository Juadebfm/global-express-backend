import axios from 'axios'
import axiosRetry from 'axios-retry'
import { env } from '../config/env'

/**
 * Cloudflare Turnstile token verification.
 *
 *   https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Token lifecycle:
 *   1. FE renders a Turnstile widget with the site key — user solves it.
 *   2. Widget invokes callback with a token (max 5 min validity).
 *   3. FE attaches the token as `cf-turnstile-response` header on the next API call.
 *   4. This service POSTs the token to Cloudflare's siteverify endpoint.
 *   5. Cloudflare returns success + per-token metadata. Single-use — Cloudflare
 *      invalidates the token after first verification.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface TurnstileVerifyResponse {
  success: boolean
  // Hostname the challenge was solved on (the FE origin).
  hostname?: string
  // ISO timestamp the challenge was solved.
  challenge_ts?: string
  // Error code(s) if success is false.
  'error-codes'?: string[]
  // Optional action/cdata set by the FE for binding.
  action?: string
  cdata?: string
}

const verifyClient = axios.create({ timeout: 10_000 })
axiosRetry(verifyClient, { retries: 2, retryDelay: axiosRetry.exponentialDelay })

export const turnstileService = {
  /** True when CAPTCHA is configured + active for this environment. */
  isEnabled(): boolean {
    return Boolean(env.TURNSTILE_SECRET_KEY) || env.TURNSTILE_REQUIRE
  },

  /**
   * Verify a Turnstile token. Returns true on success, false on any failure
   * (network, parse, Cloudflare-side rejection).
   *
   * Pass the requester IP as `remoteip` — Cloudflare uses it for additional
   * risk scoring and binds the token to that IP.
   */
  async verify(token: string, remoteIp?: string): Promise<boolean> {
    if (!env.TURNSTILE_SECRET_KEY) {
      // No secret configured. If TURNSTILE_REQUIRE is set, reject; otherwise bypass (dev).
      return !env.TURNSTILE_REQUIRE
    }

    try {
      const params = new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
      })
      if (remoteIp) params.set('remoteip', remoteIp)

      const res = await verifyClient.post<TurnstileVerifyResponse>(VERIFY_URL, params)
      return res.data.success
    } catch {
      return false
    }
  },
}
