import axios from 'axios'
import axiosRetry from 'axios-retry'
import { env } from './env'

/**
 * Hardened axios client for outbound API calls.
 *
 * - 30s timeout (Paystack/Resend have 10s targets; 30s leaves buffer for retries)
 * - Retry with exponential backoff on 5xx and network errors (3 attempts)
 * - Default headers identifying our service
 */
export const paystackClient = axios.create({
  baseURL: 'https://api.paystack.co',
  timeout: 30_000,
  headers: {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
    'User-Agent': 'global-express-backend/1.0',
  },
})

axiosRetry(paystackClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    // Retry on network errors + 5xx + 429.
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      error.response?.status === 429 ||
      (error.response?.status !== undefined && error.response.status >= 500)
    )
  },
})
