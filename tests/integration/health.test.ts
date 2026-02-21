import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

// Set required env vars before importing the app
beforeAll(() => {
  Object.assign(process.env, {
    NODE_ENV: 'development',
    PORT: '3001',
    HOST: '127.0.0.1',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    CLERK_SECRET_KEY: 'sk_test_placeholder',
    CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
    R2_ACCOUNT_ID: 'placeholder',
    R2_ACCESS_KEY_ID: 'placeholder',
    R2_SECRET_ACCESS_KEY: 'placeholder',
    R2_BUCKET_NAME: 'placeholder',
    R2_PUBLIC_URL: 'https://placeholder.example.com',
    RESEND_API_KEY: 'placeholder',
    RESEND_FROM_EMAIL: 'noreply@example.com',
    RESEND_FROM_NAME: 'Test',
    PAYSTACK_SECRET_KEY: 'sk_test_placeholder',
    PAYSTACK_PUBLIC_KEY: 'pk_test_placeholder',
    ENCRYPTION_KEY: 'a'.repeat(64),
    ADMIN_IP_WHITELIST: '127.0.0.1,::1',
    CORS_ORIGINS: 'http://localhost:3000',
  })
})

describe('GET /health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app')
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 200 with status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body) as { status: string; timestamp: string }
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })
})
