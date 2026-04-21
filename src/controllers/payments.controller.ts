import type { FastifyRequest, FastifyReply } from 'fastify'
import { paymentsService } from '../services/payments.service'
import { successResponse } from '../utils/response'
import type { PaymentStatus } from '../types/enums'
import { PaymentType, UserRole } from '../types/enums'

export const paymentsController = {
  async initializePayment(
    request: FastifyRequest<{
      Body: {
        orderId?: string
        invoiceId?: string
        amount: number
        currency?: string
        callbackUrl?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const result = await paymentsService.initializePayment({
      orderId: request.body.orderId,
      invoiceId: request.body.invoiceId,
      userId: request.user.id,
      requesterRole: request.user.role as UserRole,
      amount: request.body.amount,
      currency: request.body.currency,
      email: request.user.email,
      callbackUrl: request.body.callbackUrl,
    })

    return reply.code(201).send(successResponse(result))
  },

  async generateReceiptPresign(
    request: FastifyRequest<{
      Body: {
        orderId?: string
        invoiceId?: string
        contentType: string
        originalFileName?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await paymentsService.generateReceiptUploadUrl({
      orderId: request.body.orderId,
      invoiceId: request.body.invoiceId,
      userId: request.user.id,
      requesterRole: request.user.role as UserRole,
      contentType: request.body.contentType,
      originalFileName: request.body.originalFileName,
    })

    return reply.send(successResponse(payload))
  },

  async submitReceipt(
    request: FastifyRequest<{
      Body: {
        orderId?: string
        invoiceId?: string
        amount: number
        currency?: string
        r2Key: string
        referenceCode?: string
        note?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const payment = await paymentsService.submitPaymentReceipt({
      orderId: request.body.orderId,
      invoiceId: request.body.invoiceId,
      userId: request.user.id,
      requesterRole: request.user.role as UserRole,
      amount: request.body.amount,
      currency: request.body.currency,
      r2Key: request.body.r2Key,
      referenceCode: request.body.referenceCode,
      note: request.body.note,
    })

    return reply.code(201).send(successResponse(payment))
  },

  async verifySubmittedReceipt(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { decision: 'approve' | 'reject'; note?: string }
    }>,
    reply: FastifyReply,
  ) {
    const payment = await paymentsService.verifySubmittedReceipt({
      paymentId: request.params.id,
      verifiedBy: request.user.id,
      decision: request.body.decision,
      note: request.body.note,
    })

    return reply.send(successResponse(payment))
  },

  async verifyPayment(
    request: FastifyRequest<{ Params: { reference: string } }>,
    reply: FastifyReply,
  ) {
    const payment = await paymentsService.verifyPayment(request.params.reference)

    if (!payment) {
      return reply.code(404).send({ success: false, message: 'Payment record not found' })
    }

    // Customers can only verify their own payments
    if (
      [UserRole.USER, UserRole.SUPPLIER].includes(request.user.role as UserRole) &&
      payment.userId !== request.user.id
    ) {
      return reply.code(403).send({ success: false, message: 'Forbidden' })
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

    // Customers can only view their own payments
    if (
      [UserRole.USER, UserRole.SUPPLIER].includes(request.user.role as UserRole) &&
      payment.userId !== request.user.id
    ) {
      return reply.code(403).send({ success: false, message: 'Forbidden' })
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

  async listMyPayments(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; status?: string }
    }>,
    reply: FastifyReply,
  ) {
    const result = await paymentsService.listPayments({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      userId: request.user.id,
      status: request.query.status as PaymentStatus | undefined,
    })

    return reply.send(successResponse(result))
  },

  async recordOfflinePayment(
    request: FastifyRequest<{
      Params: { orderId: string }
      Body: {
        userId: string
        invoiceId?: string
        amount: number
        paymentType: PaymentType.TRANSFER | PaymentType.CASH
        proofReference?: string
        note?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const payment = await paymentsService.recordOfflinePayment({
      orderId: request.params.orderId,
      invoiceId: request.body.invoiceId,
      userId: request.body.userId,
      recordedBy: request.user.id,
      amount: request.body.amount,
      paymentType: request.body.paymentType,
      proofReference: request.body.proofReference,
      note: request.body.note,
    })

    return reply.code(201).send(successResponse(payment))
  },
}
