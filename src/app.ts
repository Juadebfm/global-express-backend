import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import websocketPlugin from '@fastify/websocket'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import { registerRoutes } from './routes'
import { registerWebSocketRoutes } from './websocket'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      // Never log authorization headers or any sensitive request fields
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'req.body.cardNumber',
        'req.body.cvv',
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
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        scriptSrc: ["'self'"],
      },
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

  // ─── Swagger ──────────────────────────────────────────────────────────────
  if (true) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Global Express API',
          description: 'Shipment Order Tracking System REST API',
          version: '1.0.0',
        },
        servers: [{ url: `http://localhost:${env.PORT}`, description: 'Local' }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'Clerk session JWT',
            },
          },
        },
      },
    })

    await app.register(swaggerUI, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    })
  }

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

  // ─── Centralized error handler ────────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  // ─── Routes ───────────────────────────────────────────────────────────────
  await registerRoutes(app)

  // ─── WebSocket routes ─────────────────────────────────────────────────────
  registerWebSocketRoutes(app)

  return app
}
