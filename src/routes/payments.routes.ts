import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { paymentsController } from '../controllers/payments.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireStaffOrAbove } from '../middleware/requireRole'
import { PaymentStatus, PaymentType } from '../types/enums'

const paymentResponseSchema = z.object({
  id: z.string().uuid().describe('Payment UUID'),
  orderId: z.string().uuid().describe('UUID of the linked order'),
  userId: z.string().uuid().describe('UUID of the customer who made the payment'),
  amount: z.string().describe('Amount in major currency units (e.g. "5000" = ₦5,000)'),
  currency: z.string().describe('ISO currency code (e.g. NGN)'),
  paystackReference: z.string().nullable().describe('Paystack transaction reference — null for offline payments'),
  paystackTransactionId: z.string().nullable().describe('Paystack internal transaction ID (set after successful payment)'),
  status: z.nativeEnum(PaymentStatus).describe('Payment status: pending | successful | failed | abandoned'),
  paymentType: z.nativeEnum(PaymentType).describe('Payment method: online | transfer | cash'),
  recordedBy: z.string().uuid().nullable().describe('Staff member who recorded an offline payment'),
  proofReference: z.string().nullable().describe('Bank receipt or proof reference for offline payment'),
  note: z.string().nullable().describe('Optional staff note for offline payment'),
  paidAt: z.string().nullable().describe('Timestamp when payment was confirmed'),
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
      description: `Creates a Paystack payment transaction for an order. Returns an \`authorizationUrl\` — redirect the customer to this URL to complete payment on Paystack's hosted page.

**Amount** must be in **kobo** (smallest currency unit):
- ₦5,000 → \`amount: 500000\`
- ₦100 → \`amount: 10000\`

After the customer pays and returns to your \`callbackUrl\`, call \`POST /api/v1/payments/verify/:reference\` to confirm the payment status.

**Example request body:**
\`\`\`json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 500000,
  "currency": "NGN",
  "callbackUrl": "https://yourapp.com/payment/callback"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      body: z.object({
        orderId: z.string().uuid().describe('UUID of the order being paid for'),
        amount: z.number().int().positive().describe('Amount in kobo — ₦5,000 = 500000'),
        currency: z.string().default('NGN').optional().describe('ISO currency code (default: NGN)'),
        callbackUrl: z.string().url().optional().describe('URL Paystack redirects to after payment — include your success/failure handling'),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            payment: paymentResponseSchema,
            authorizationUrl: z.string().url().describe('Redirect the customer to this Paystack hosted payment page'),
            reference: z.string().describe('Paystack reference — use this to verify the payment'),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: paymentsController.initializePayment,
  })

  app.post('/verify/:reference', {
    preHandler: [authenticate],
    schema: {
      tags: ['Payments'],
      summary: 'Verify a Paystack payment by reference',
      description: `Verifies the current status of a payment with Paystack using its reference. Call this after the customer returns from the Paystack hosted payment page.

**Example:** \`POST /api/v1/payments/verify/paystack_ref_abc123\`

Returns the updated payment record with the confirmed status.`,
      security: [{ bearerAuth: [] }],
      params: z.object({ reference: z.string().min(1).describe('Paystack transaction reference (returned from /initialize)') }),
      response: {
        200: z.object({ success: z.literal(true), data: paymentResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
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
      description: `Receives Paystack charge events and updates payment status automatically.

Signature is verified via the \`x-paystack-signature\` header (HMAC-SHA512).

**Events handled:**
- \`charge.success\` — marks payment as \`successful\`
- \`charge.failed\` — marks payment as \`failed\`

> **Note:** This endpoint is called by Paystack's servers, not by your frontend. Set the webhook URL in your [Paystack Dashboard](https://dashboard.paystack.com/#/settings/developer) → API Keys & Webhooks.`,
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
      description: `Returns a paginated list of all payment records. Filter by customer or status.

**Filter examples:**
- Successful payments: \`?status=successful\`
- Payments by customer: \`?userId=<uuid>\`
- Failed payments: \`?status=failed\``,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100)'),
        userId: z.string().uuid().optional().describe('Filter by customer UUID'),
        status: z.nativeEnum(PaymentStatus).optional().describe('Filter by status: pending | successful | failed | abandoned'),
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
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: paymentsController.listPayments,
  })

  app.get('/:id', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Payments — Admin'],
      summary: 'Get a payment by ID',
      description: 'Returns a single payment record by its internal UUID.',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Payment UUID') }),
      response: {
        200: z.object({ success: z.literal(true), data: paymentResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: paymentsController.getPaymentById,
  })

  app.post('/:orderId/record-offline', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Payments — Admin'],
      summary: 'Record an offline payment (staff+)',
      description: `Records a cash or bank-transfer payment collected outside of Paystack. Immediately marks the order's \`paymentCollectionStatus\` as \`PAID_IN_FULL\`.

**Example — bank transfer:**
\`\`\`json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 45000,
  "paymentType": "transfer",
  "proofReference": "TRF-2024-00123",
  "note": "Customer transferred ₦45,000 on Feb 26"
}
\`\`\`

**Example — cash:**
\`\`\`json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 20000,
  "paymentType": "cash",
  "note": "Collected at Lagos office"
}
\`\`\``,
      security: [{ bearerAuth: [] }],
      params: z.object({ orderId: z.string().uuid().describe('UUID of the order being paid for') }),
      body: z.object({
        userId: z.string().uuid().describe('UUID of the customer making the payment'),
        amount: z.number().positive().describe('Amount in major currency units (NGN) — e.g. 45000 = ₦45,000'),
        paymentType: z.enum(['transfer', 'cash']).describe('Offline payment method: transfer | cash'),
        proofReference: z.string().optional().describe('Bank receipt / transfer reference code'),
        note: z.string().optional().describe('Optional staff note about the payment'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: paymentResponseSchema }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: paymentsController.recordOfflinePayment,
  })
}
