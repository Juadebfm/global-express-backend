import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { paymentsController } from '../controllers/payments.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove } from '../middleware/requireRole'
import { PaymentStatus } from '../types/enums'

const paymentResponseSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.string(),
  currency: z.string(),
  paystackReference: z.string(),
  paystackTransactionId: z.string().nullable(),
  status: z.nativeEnum(PaymentStatus),
  paidAt: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function paymentsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/initialize', {
    preHandler: [authenticate],
    config: {
      // Stricter rate limit on payment init
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['Payments'],
      summary: 'Initialize a Paystack payment',
      security: [{ bearerAuth: [] }],
      body: z.object({
        orderId: z.string().uuid(),
        amount: z.number().int().positive().describe('Amount in kobo (smallest currency unit)'),
        currency: z.string().default('NGN').optional(),
        callbackUrl: z.string().url().optional(),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            payment: paymentResponseSchema,
            authorizationUrl: z.string().url(),
            reference: z.string(),
          }),
        }),
      },
    },
    handler: paymentsController.initializePayment,
  })

  app.post('/verify/:reference', {
    preHandler: [authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Verify a Paystack payment by reference',
      security: [{ bearerAuth: [] }],
      params: z.object({ reference: z.string().min(1) }),
      response: {
        200: z.object({ success: z.literal(true), data: paymentResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: paymentsController.verifyPayment,
  })

  /**
   * Paystack webhook — no auth middleware, but signature is verified in the service.
   * Must receive the raw body for HMAC-SHA512 verification.
   */
  app.post('/webhook', {
    config: {
      // Higher limit for Paystack — they may retry failed deliveries
      rateLimit: { max: 500, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['Payments'],
      summary: 'Paystack webhook receiver',
      description:
        'Receives Paystack charge events. Signature is verified via x-paystack-signature header.',
      response: {
        200: z.object({ success: z.literal(true) }),
        400: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: paymentsController.handleWebhook,
  })

  app.get('/', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Payments — Admin'],
      summary: 'List all payments',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        userId: z.string().uuid().optional(),
        status: z.nativeEnum(PaymentStatus).optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(paymentResponseSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
      },
    },
    handler: paymentsController.listPayments,
  })

  app.get('/:id', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Payments — Admin'],
      summary: 'Get a payment by ID',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: paymentResponseSchema }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: paymentsController.getPaymentById,
  })
}
