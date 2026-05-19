import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import websocketPlugin from '@fastify/websocket'
import multipart from '@fastify/multipart'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import { registerRoutes } from './routes'
import { registerWebSocketRoutes } from './websocket'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      // Never log authorization headers, credentials, or PII fields.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-paystack-signature"]',
        'req.headers["svix-signature"]',
        'req.body.password',
        'req.body.newPassword',
        'req.body.currentPassword',
        'req.body.token',
        'req.body.otp',
        'req.body.cardNumber',
        'req.body.cvv',
        'req.body.email',
        'req.body.phone',
        'req.body.whatsappNumber',
        'req.body.firstName',
        'req.body.lastName',
        'req.body.nationalId',
        'req.body.dateOfBirth',
      ],
    },
    trustProxy: true, // Required for correct req.ip on Render (behind a load balancer)
  })

  // ─── Zod type provider ───────────────────────────────────────────────────
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // ─── Security headers ────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
      },
    },
    // Explicit HSTS — 2 years, include subdomains, eligible for preload list.
    // Set explicitly (rather than relying on helmet defaults) so it's reviewable
    // and survives helmet major-version bumps.
    strictTransportSecurity: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
  })

  // ─── CORS ─────────────────────────────────────────────────────────────────
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim())
  await app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition'],
    credentials: true,
  })

  // ─── Global rate limiting ─────────────────────────────────────────────────
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      success: false,
      message: `Too many requests — you are being rate limited. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  })

  // ─── WebSocket ────────────────────────────────────────────────────────────
  await app.register(websocketPlugin)

  // ─── Multipart uploads ────────────────────────────────────────────────────
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 10 * 1024 * 1024, // 10MB upload cap for import sheets
    },
  })

  // ─── Webhook raw body capture ─────────────────────────────────────────────
  // Raw body is required for signature verification:
  //   • Paystack HMAC-SHA512  →  /payments/webhook
  //   • Clerk svix signature  →  /webhooks/*
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (
      request.url.includes('/payments/webhook') ||
      request.url.includes('/webhooks/')
    ) {
      const chunks: Buffer[] = []
      for await (const chunk of payload) {
        chunks.push(chunk as Buffer)
      }
      const rawBody = Buffer.concat(chunks).toString('utf8')
      request.rawBody = rawBody

      // Return a new readable stream from the buffered body so Fastify can still parse it
      const { Readable } = await import('stream')
      const stream = Readable.from([rawBody])
      return stream
    }
    return payload
  })

  // ─── Handle empty JSON bodies ────────────────────────────────────────────
  // Fastify rejects empty bodies with Content-Type: application/json by default.
  // Many FE frameworks send this header even on PATCH/DELETE with no body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (typeof body === 'string' && body.trim().length === 0) {
      done(null, undefined)
    } else {
      try {
        done(null, JSON.parse(body as string))
      } catch (err) {
        done(err as Error, undefined)
      }
    }
  })

  // ─── Cache-Control on PII / authenticated responses (ASVS 8.2.1) ──────────
  // Prevent intermediate caches from storing user-scoped or admin data.
  // Applies to every endpoint that returns PII or privileged data.
  const noStorePathPrefixes = [
    '/api/v1/users/',
    '/api/v1/auth/',
    '/api/v1/admin/',
    '/api/v1/internal/',
    '/api/v1/payments/',
    '/api/v1/orders/',
    '/api/v1/dashboard',
    '/api/v1/notifications',
    '/api/v1/shipments',
    '/api/v1/team',
    '/api/v1/support/',
    '/api/v1/reports/',
  ]
  app.addHook('onSend', async (request, reply, payload) => {
    if (noStorePathPrefixes.some((prefix) => request.url.startsWith(prefix))) {
      reply.header('Cache-Control', 'no-store, private')
      reply.header('Pragma', 'no-cache')
    }
    return payload
  })

  // ─── Centralized error handler ────────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  // ─── Routes ───────────────────────────────────────────────────────────────
  await registerRoutes(app)

  // ─── WebSocket routes ─────────────────────────────────────────────────────
  registerWebSocketRoutes(app)

  return app
}
