import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import websocketPlugin from '@fastify/websocket'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import etag from '@fastify/etag'
import fastifyMetrics from 'fastify-metrics'
import {
  serializerCompiler as zodSerializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import { captureIdempotencyResult, persistIdempotencyResult } from './middleware/idempotency'
import { PROBLEM_CONTENT_TYPE, reshapeLegacyToProblem } from './utils/problem-details'
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
  // fastify-type-provider-zod v6 runs safeParse(schema, data) before JSON.stringify.
  // Drizzle returns timestamp columns as Date objects; z.string() rejects them → 500.
  // JSON.parse(JSON.stringify(data)) converts Dates to ISO strings before Zod sees them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.setSerializerCompiler((opts: any) => {
    const inner = zodSerializerCompiler(opts)
    return (data) => inner(JSON.parse(JSON.stringify(data)))
  })

  // ─── OpenAPI / Swagger ────────────────────────────────────────────────────
  // Generates an OpenAPI 3 spec from the Zod schemas on every route and serves
  // an interactive explorer at /docs plus a raw spec at /openapi.json.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Global Express Backend API',
        description:
          'Shipment ordering and tracking API. Authenticated endpoints require `Authorization: Bearer <jwt>`. See SECURITY.md for vulnerability reporting and API_ENDPOINTS.md for the human-curated reference.',
        version: '1.0.0',
      },
      servers: [
        { url: 'https://api.globalexpress.kr', description: 'Production' },
        { url: 'http://localhost:3000', description: 'Local dev' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  })

  // Expose the raw OpenAPI 3 spec at /openapi.json (canonical location for
  // openapi-generator-cli + most FE SDK tooling). The Swagger plugin only
  // serves the spec at /docs/json by default; this is a friendlier alias.
  app.get('/openapi.json', { schema: { hide: true } }, async (_request, reply) => {
    reply.header('Content-Type', 'application/json; charset=utf-8')
    return app.swagger()
  })

  // ─── ETag + conditional GET (304) ─────────────────────────────────────────
  // Generates a weak SHA-1 ETag from response payload on GET responses and
  // returns 304 Not Modified when If-None-Match matches. Reduces bandwidth
  // and origin load for clients that re-fetch the same resource.
  await app.register(etag, { algorithm: 'sha1', weak: true })

  // ─── Prometheus metrics at /metrics ───────────────────────────────────────
  // Per-route histogram of request duration + counters by status code.
  // The exposed endpoint is unauthenticated (standard practice) — protect it
  // at the LB/firewall layer in prod if needed.
  await app.register(fastifyMetrics, {
    endpoint: '/metrics',
    defaultMetrics: { enabled: true },
    routeMetrics: {
      enabled: true,
      registeredRoutesOnly: false,
    },
  })

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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'If-None-Match',
      'cf-turnstile-response',
    ],
    exposedHeaders: ['Content-Disposition', 'X-Request-ID', 'Idempotent-Replayed'],
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

  // Public GET endpoints — output is identical for every caller; safe to cache
  // at the CDN/browser for short windows. Reduces origin load for marketing
  // pages and the public calculator.
  const publicCacheableGetPathPrefixes = [
    '/api/v1/public/shipment-types',
    '/api/v1/public/calculator/rates',
    '/api/v1/public/gallery',
  ]

  app.addHook('onSend', (request, reply, payload, done) => {
    // X-Request-ID — propagate Fastify's per-request id back so the client can
    // quote it when reporting issues (observability best practice).
    reply.header('X-Request-ID', request.id)

    if (noStorePathPrefixes.some((prefix) => request.url.startsWith(prefix))) {
      reply.header('Cache-Control', 'no-store, private')
      reply.header('Pragma', 'no-cache')
    } else if (
      request.method === 'GET' &&
      publicCacheableGetPathPrefixes.some((prefix) => request.url.startsWith(prefix))
    ) {
      // 5 min cache for public catalog data; CDN can serve stale-while-revalidate.
      reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
      reply.header('Vary', 'Accept, Accept-Encoding')
    }

    // Capture payload (sync) for the idempotency-key replay store. The DB
    // write itself happens after the response is sent — see onResponse below.
    done(null, captureIdempotencyResult(request, reply, payload))
  })

  // ─── Idempotency-Key persistence (after response) ─────────────────────────
  // Fires AFTER the client has the response, so the DB write doesn't extend
  // response latency. Routes opt in by adding `checkIdempotencyKey` to their
  // preHandler list.
  app.addHook('onResponse', async (request) => {
    await persistIdempotencyResult(request)
  })

  // ─── RFC 7807 error reshape hook ──────────────────────────────────────────
  // Detects the legacy `{ success: false, message }` shape returned by
  // preHandlers and middleware and reshapes it into Problem Details so the
  // entire API speaks `application/problem+json` for errors. Runs BEFORE
  // response schema validation so the reshaped payload is what's serialized.
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (reply.statusCode < 400) return payload
    const reshaped = reshapeLegacyToProblem(payload, request, reply.statusCode)
    if (reshaped !== payload) {
      reply.header('Content-Type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`)
    }
    return reshaped
  })

  // ─── Centralized error handler ────────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  // ─── 404 handler — route through the same RFC 7807 emitter ───────────────
  // Fastify's default 404 produces { message, error, statusCode } which would
  // bypass the Problem Details contract. Hand-off to the error handler so the
  // wire format stays uniform.
  app.setNotFoundHandler((request, reply) => {
    const err = Object.assign(new Error(`Route ${request.method}:${request.url} not found`), {
      statusCode: 404,
      validation: undefined,
    })
    errorHandler(err as Parameters<typeof errorHandler>[0], request, reply)
  })

  // ─── Routes ───────────────────────────────────────────────────────────────
  await registerRoutes(app)

  // ─── WebSocket routes ─────────────────────────────────────────────────────
  registerWebSocketRoutes(app)

  return app
}
