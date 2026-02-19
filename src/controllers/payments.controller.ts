import type { FastifyRequest, FastifyReply } from 'fastify'
import { paymentsService } from '../services/payments.service'
import { successResponse } from '../utils/response'
import type { PaymentStatus } from '../types/enums'

export const paymentsController = {
  async initializePayment(
    request: FastifyRequest<{
      Body: {
        orderId: string
        amount: number
        currency?: string
        callbackUrl?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const result = await paymentsService.initializePayment({
      orderId: request.body.orderId,
      userId: request.user.id,
      amount: request.body.amount,
      currency: request.body.currency,
      email: request.user.email,
      callbackUrl: request.body.callbackUrl,
    })

    return reply.code(201).send(successResponse(result))
  },

  async verifyPayment(
    request: FastifyRequest<{ Params: { reference: string } }>,
    reply: FastifyReply,
  ) {
    const payment = await paymentsService.verifyPayment(request.params.reference)

    if (!payment) {
      return reply.code(404).send({ success: false, message: 'Payment record not found' })
    }

    return reply.send(successResponse(payment))
  },

  /**
   * Paystack webhook endpoint.
   * Signature is verified inside the service before any processing occurs.
   * PCI-DSS: raw body is passed for HMAC verification only — never logged beyond what's needed.
   */
  async handleWebhook(request: FastifyRequest, reply: FastifyReply) {
    const signature = request.headers['x-paystack-signature'] as string | undefined

    if (!signature) {
      return reply.code(400).send({ success: false, message: 'Missing webhook signature' })
    }

    if (!request.rawBody) {
      return reply.code(400).send({ success: false, message: 'Raw body unavailable' })
    }

    const result = await paymentsService.handleWebhookEvent(request.rawBody, signature)

    request.log.info({ processed: result.processed }, 'Paystack webhook processed')

    // Always respond 200 quickly to Paystack — processing is handled asynchronously
    return reply.code(200).send({ success: true })
  },

  async getPaymentById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const payment = await paymentsService.getPaymentById(request.params.id)

    if (!payment) {
      return reply.code(404).send({ success: false, message: 'Payment not found' })
    }

    return reply.send(successResponse(payment))
  },

  async listPayments(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; userId?: string; status?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await paymentsService.listPayments({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      userId: request.query.userId,
      status: request.query.status as PaymentStatus | undefined,
    })

    return reply.send(successResponse(result))
  },
}
