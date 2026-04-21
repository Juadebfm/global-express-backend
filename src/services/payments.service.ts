import { createHmac } from 'crypto'
import { eq, and, desc, sql, isNull } from 'drizzle-orm'
import axios from 'axios'
import { db } from '../config/db'
import { payments, orders, invoices } from '../../drizzle/schema'
import { notificationsService, notifyUser } from './notifications.service'
import { dispatchBatchesService } from './dispatch-batches.service'
import { PaymentCollectionStatus, UserRole } from '../types/enums'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { env } from '../config/env'
import type { PaginationParams } from '../types'
import { PaymentStatus, PaymentType } from '../types/enums'
import { uploadsService } from './uploads.service'

const PAYSTACK_API = 'https://api.paystack.co'
const ALLOWED_RECEIPT_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

export interface InitializePaymentInput {
  orderId?: string
  invoiceId?: string
  userId: string
  requesterRole: UserRole
  amount: number // in smallest currency unit (kobo for NGN)
  currency?: string
  email: string
  callbackUrl?: string
  metadata?: Record<string, unknown>
}

export interface PaystackInitializeResponse {
  status: boolean
  message: string
  data: {
    authorization_url: string
    access_code: string
    reference: string
  }
}

export interface PaystackVerifyResponse {
  status: boolean
  message: string
  data: {
    id: number
    reference: string
    status: string
    amount: number
    currency: string
    paid_at: string | null
    metadata: unknown
  }
}

export interface GeneratePaymentReceiptUploadUrlInput {
  orderId?: string
  invoiceId?: string
  userId: string
  requesterRole: UserRole
  contentType: string
  originalFileName?: string
}

export interface SubmitPaymentReceiptInput {
  orderId?: string
  invoiceId?: string
  userId: string
  requesterRole: UserRole
  amount: number
  currency?: string
  r2Key: string
  referenceCode?: string
  note?: string
}

interface ResolvedPaymentTarget {
  orderId: string
  senderId: string
  billingSupplierId: string | null
  invoiceId: string
  billToUserId: string | null
  billToSupplierId: string | null
}

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

export class PaymentsService {
  async initializePayment(input: InitializePaymentInput) {
    const { userId, requesterRole, amount, email, callbackUrl, metadata } = input
    const currency = input.currency ?? 'NGN'
    const target = await this.resolvePaymentTarget({
      orderId: input.orderId,
      invoiceId: input.invoiceId,
    })

    this.assertPaymentOwnership({
      requesterId: userId,
      requesterRole,
      target,
    })

    const response = await axios.post<PaystackInitializeResponse>(
      `${PAYSTACK_API}/transaction/initialize`,
      {
        email,
        amount, // Paystack expects amount in kobo
        currency,
        callback_url: callbackUrl,
        metadata,
      },
      {
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    )

    if (!response.data.status) {
      throw new Error(`Paystack initialization failed: ${response.data.message}`)
    }

    const { reference, authorization_url } = response.data.data

    // Persist the pending payment record
    const [payment] = await db
      .insert(payments)
      .values({
        orderId: target.orderId,
        invoiceId: target.invoiceId,
        userId,
        amount: String(amount / 100), // store in major units
        currency,
        paystackReference: reference,
        status: PaymentStatus.PENDING,
      })
      .returning()

    return {
      payment,
      authorizationUrl: authorization_url,
      reference,
    }
  }

  async generateReceiptUploadUrl(input: GeneratePaymentReceiptUploadUrlInput) {
    if (!ALLOWED_RECEIPT_CONTENT_TYPES.has(input.contentType)) {
      throw httpError(
        `Unsupported content type. Allowed: ${[...ALLOWED_RECEIPT_CONTENT_TYPES].join(', ')}`,
        400,
      )
    }

    const target = await this.resolvePaymentTarget({
      orderId: input.orderId,
      invoiceId: input.invoiceId,
    })

    this.assertPaymentOwnership({
      requesterId: input.userId,
      requesterRole: input.requesterRole,
      target,
    })

    return uploadsService.generatePaymentReceiptPresignedUrl({
      orderId: target.orderId,
      contentType: input.contentType,
      originalFileName: input.originalFileName,
    })
  }

  async submitPaymentReceipt(input: SubmitPaymentReceiptInput) {
    if (input.amount <= 0) {
      throw httpError('Payment amount must be greater than zero', 400)
    }

    const currency = (input.currency ?? 'NGN').toUpperCase()
    const target = await this.resolvePaymentTarget({
      orderId: input.orderId,
      invoiceId: input.invoiceId,
    })

    this.assertPaymentOwnership({
      requesterId: input.userId,
      requesterRole: input.requesterRole,
      target,
    })

    const expectedPrefix = `payments/${target.orderId}/`
    if (!input.r2Key.startsWith(expectedPrefix)) {
      throw httpError('Invalid receipt key for this order', 400)
    }

    const proofUrl = `${env.R2_PUBLIC_URL}/${input.r2Key}`

    const [payment] = await db
      .insert(payments)
      .values({
        orderId: target.orderId,
        invoiceId: target.invoiceId,
        userId: input.userId,
        amount: input.amount.toFixed(2),
        currency,
        status: PaymentStatus.PENDING,
        paymentType: PaymentType.TRANSFER,
        proofReference: proofUrl,
        note: input.note ?? null,
        metadata: {
          receiptR2Key: input.r2Key,
          referenceCode: input.referenceCode ?? null,
          submittedByRole: input.requesterRole,
          submittedAt: new Date().toISOString(),
        },
      })
      .returning()

    await db
      .update(orders)
      .set({
        paymentCollectionStatus: PaymentCollectionStatus.PAYMENT_IN_PROGRESS,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, target.orderId))

    notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'payment_event',
      title: 'Payment Receipt Submitted',
      body: `Receipt submitted for order ${target.orderId}. Awaiting superadmin verification.`,
      metadata: {
        paymentId: payment.id,
        orderId: target.orderId,
        invoiceId: target.invoiceId,
        submittedBy: input.userId,
      },
    })

    return payment
  }

  async verifySubmittedReceipt(input: {
    paymentId: string
    verifiedBy: string
    decision: 'approve' | 'reject'
    note?: string
  }) {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1)

    if (!payment) {
      throw httpError('Payment not found', 404)
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw httpError('Only pending receipt submissions can be verified', 409)
    }

    const isApproved = input.decision === 'approve'
    const now = new Date()

    const [updated] = await db
      .update(payments)
      .set({
        status: isApproved ? PaymentStatus.SUCCESSFUL : PaymentStatus.FAILED,
        recordedBy: input.verifiedBy,
        paidAt: isApproved ? now : null,
        note: input.note ?? payment.note ?? null,
        updatedAt: now,
      })
      .where(eq(payments.id, payment.id))
      .returning()

    if (!updated) {
      throw httpError('Payment not found', 404)
    }

    if (isApproved) {
      await db
        .update(orders)
        .set({
          paymentCollectionStatus: PaymentCollectionStatus.PAID_IN_FULL,
          updatedAt: now,
        })
        .where(eq(orders.id, payment.orderId))

      await dispatchBatchesService.markInvoicePaidByOrder({
        orderId: payment.orderId,
        actorId: input.verifiedBy,
        paidAt: updated.paidAt,
      })

      notificationsService.notifyRole({
        targetRole: UserRole.STAFF,
        type: 'payment_received',
        title: 'Payment Receipt Approved',
        body: `Receipt approved for order ${payment.orderId}.`,
        metadata: { paymentId: payment.id, orderId: payment.orderId },
      })
    } else {
      const [counts] = await db
        .select({
          successful: sql<number>`count(*) filter (where ${payments.status} = 'successful')::int`,
          pending: sql<number>`count(*) filter (where ${payments.status} = 'pending')::int`,
        })
        .from(payments)
        .where(eq(payments.orderId, payment.orderId))

      const nextStatus =
        (counts?.successful ?? 0) > 0
          ? PaymentCollectionStatus.PAID_IN_FULL
          : (counts?.pending ?? 0) > 0
            ? PaymentCollectionStatus.PAYMENT_IN_PROGRESS
            : PaymentCollectionStatus.UNPAID

      await db
        .update(orders)
        .set({ paymentCollectionStatus: nextStatus, updatedAt: now })
        .where(eq(orders.id, payment.orderId))

      notificationsService.notifyRole({
        targetRole: UserRole.STAFF,
        type: 'payment_failed',
        title: 'Payment Receipt Rejected',
        body: `Receipt rejected for order ${payment.orderId}.`,
        metadata: { paymentId: payment.id, orderId: payment.orderId },
      })
    }

    await notifyUser({
      userId: payment.userId,
      orderId: payment.orderId,
      type: 'payment_event',
      title: isApproved ? 'Payment Verified' : 'Payment Receipt Rejected',
      subtitle: payment.orderId,
      body: isApproved
        ? 'Your submitted payment receipt has been verified successfully.'
        : 'Your submitted payment receipt was rejected. Please submit a valid proof.',
      createdBy: input.verifiedBy,
      metadata: {
        paymentId: payment.id,
        decision: input.decision,
      },
    })

    return updated
  }

  private async resolvePaymentTarget(input: {
    orderId?: string
    invoiceId?: string
  }): Promise<ResolvedPaymentTarget> {
    if (!input.orderId && !input.invoiceId) {
      throw httpError('orderId or invoiceId is required', 400)
    }

    let resolvedOrderId = input.orderId
    let resolvedInvoiceId = input.invoiceId
    let invoiceContext:
      | {
        id: string
        orderId: string
        billToUserId: string | null
        billToSupplierId: string | null
      }
      | null = null

    if (input.invoiceId) {
      const [invoice] = await db
        .select({
          id: invoices.id,
          orderId: invoices.orderId,
          billToUserId: invoices.billToUserId,
          billToSupplierId: invoices.billToSupplierId,
        })
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId))
        .limit(1)

      if (!invoice) {
        throw httpError('Invoice not found', 404)
      }

      invoiceContext = invoice
      resolvedOrderId = invoice.orderId
      resolvedInvoiceId = invoice.id
    }

    if (!resolvedOrderId) {
      throw httpError('orderId or invoiceId is required', 400)
    }

    if (input.orderId && input.invoiceId && input.orderId !== resolvedOrderId) {
      throw httpError('Provided orderId does not match invoiceId', 400)
    }

    const [order] = await db
      .select({
        id: orders.id,
        senderId: orders.senderId,
        billingSupplierId: orders.billingSupplierId,
      })
      .from(orders)
      .where(and(eq(orders.id, resolvedOrderId), isNull(orders.deletedAt)))
      .limit(1)

    if (!order) {
      throw httpError('Order not found', 404)
    }

    if (!invoiceContext) {
      const invoice = await dispatchBatchesService.getInvoiceByOrderId(order.id)
      if (!invoice) {
        throw httpError('Invoice not found for order', 404)
      }

      invoiceContext = {
        id: invoice.id,
        orderId: invoice.orderId,
        billToUserId: invoice.billToUserId,
        billToSupplierId: invoice.billToSupplierId,
      }
      resolvedInvoiceId = invoice.id
    }

    if (!resolvedInvoiceId || !invoiceContext) {
      throw httpError('Invoice not found', 404)
    }

    return {
      orderId: order.id,
      senderId: order.senderId,
      billingSupplierId: order.billingSupplierId,
      invoiceId: resolvedInvoiceId,
      billToUserId: invoiceContext.billToUserId,
      billToSupplierId: invoiceContext.billToSupplierId,
    }
  }

  private assertPaymentOwnership(params: {
    requesterId: string
    requesterRole: UserRole
    target: ResolvedPaymentTarget
  }) {
    if (params.requesterRole === UserRole.USER) {
      const ownsOrder = params.target.senderId === params.requesterId
      const isInvoiceAddressee = params.target.billToUserId === params.requesterId

      if (!ownsOrder && !isInvoiceAddressee) {
        throw httpError('Forbidden', 403)
      }
      return
    }

    if (params.requesterRole === UserRole.SUPPLIER) {
      const ownsOrder = params.target.senderId === params.requesterId
      const isBilledSupplier =
        params.target.billToSupplierId === params.requesterId ||
        params.target.billingSupplierId === params.requesterId

      if (!ownsOrder && !isBilledSupplier) {
        throw httpError('Forbidden', 403)
      }
    }
  }

  async verifyPayment(reference: string) {
    const response = await axios.get<PaystackVerifyResponse>(
      `${PAYSTACK_API}/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      },
    )

    if (!response.data.status) {
      throw new Error(`Paystack verification failed: ${response.data.message}`)
    }

    const paystackData = response.data.data
    const newStatus = this.mapPaystackStatus(paystackData.status)

    const [updated] = await db
      .update(payments)
      .set({
        status: newStatus,
        paystackTransactionId: String(paystackData.id),
        paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : null,
        updatedAt: new Date(),
      })
      .where(eq(payments.paystackReference, reference))
      .returning()

    if (updated && newStatus === PaymentStatus.SUCCESSFUL) {
      await db
        .update(orders)
        .set({ paymentCollectionStatus: 'PAID_IN_FULL', updatedAt: new Date() })
        .where(eq(orders.id, updated.orderId))
      await dispatchBatchesService.markInvoicePaidByOrder({
        orderId: updated.orderId,
        paidAt: updated.paidAt,
      })
    }

    return updated ?? null
  }

  async recordOfflinePayment(input: {
    orderId?: string
    invoiceId?: string
    userId: string
    recordedBy: string
    amount: number // major currency units (NGN)
    paymentType: PaymentType.TRANSFER | PaymentType.CASH
    proofReference?: string
    note?: string
  }) {
    let resolvedOrderId = input.orderId

    if (!resolvedOrderId && input.invoiceId) {
      const [invoice] = await db
        .select({ orderId: invoices.orderId })
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId))
        .limit(1)
      resolvedOrderId = invoice?.orderId
    }

    if (!resolvedOrderId) {
      throw new Error('orderId or invoiceId is required')
    }

    // Validate: order must exist and amount must not exceed the order charge
    const [order] = await db
      .select({ finalChargeUsd: orders.finalChargeUsd, calculatedChargeUsd: orders.calculatedChargeUsd })
      .from(orders)
      .where(and(eq(orders.id, resolvedOrderId), isNull(orders.deletedAt)))

    if (!order) {
      throw new Error('Order not found')
    }

    if (input.amount <= 0) {
      throw new Error('Payment amount must be greater than zero')
    }

    const orderCharge = parseFloat(order.finalChargeUsd ?? order.calculatedChargeUsd ?? '0')
    if (orderCharge > 0 && input.amount > orderCharge * 100) {
      // Sanity check: amount in NGN should not wildly exceed the USD charge * rough conversion
      // This prevents accidental or malicious extreme amounts (e.g. staff typo adding extra zeros)
      throw new Error('Payment amount appears unreasonably high for this order')
    }

    const [payment] = await db.transaction(async (tx) => {
      const [newPayment] = await tx
        .insert(payments)
        .values({
          orderId: resolvedOrderId,
          invoiceId: input.invoiceId ?? null,
          userId: input.userId,
          amount: String(input.amount),
          currency: 'NGN',
          // paystackReference intentionally null for offline payments
          status: PaymentStatus.SUCCESSFUL,
          paymentType: input.paymentType,
          recordedBy: input.recordedBy,
          proofReference: input.proofReference ?? null,
          note: input.note ?? null,
          paidAt: new Date(),
        })
        .returning()

      await tx
        .update(orders)
        .set({ paymentCollectionStatus: 'PAID_IN_FULL', updatedAt: new Date() })
        .where(eq(orders.id, resolvedOrderId))

      return [newPayment]
    })

    await dispatchBatchesService.markInvoicePaidByOrder({
      orderId: resolvedOrderId,
      actorId: input.recordedBy,
      paidAt: payment.paidAt,
    })

    return payment
  }

  /**
   * Verifies the Paystack webhook signature and processes the event.
   * MUST always verify the x-paystack-signature header before processing.
   * PCI-DSS: never log raw webhook payloads containing card data.
   */
  async handleWebhookEvent(rawBody: string, signature: string) {
    // Always verify signature first
    const expectedSignature = createHmac('sha512', env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex')

    if (expectedSignature !== signature) {
      throw new Error('Invalid webhook signature')
    }

    const event = JSON.parse(rawBody) as {
      event: string
      data: { reference: string; status: string; id: number; paid_at: string | null }
    }

    if (event.event === 'charge.success') {
      const [payment] = await db
        .update(payments)
        .set({
          status: PaymentStatus.SUCCESSFUL,
          paystackTransactionId: String(event.data.id),
          paidAt: event.data.paid_at ? new Date(event.data.paid_at) : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(payments.paystackReference, event.data.reference))
        .returning()

      if (payment) {
        await db
          .update(orders)
          .set({ paymentCollectionStatus: 'PAID_IN_FULL', updatedAt: new Date() })
          .where(eq(orders.id, payment.orderId))
        await dispatchBatchesService.markInvoicePaidByOrder({
          orderId: payment.orderId,
          paidAt: payment.paidAt,
        })
      }

      // Fire-and-forget: notify superadmin of successful payment
      notificationsService.notifyRole({
        targetRole: UserRole.STAFF,
        type: 'payment_received',
        title: 'Payment Received',
        body: `Payment received for reference ${event.data.reference}`,
        metadata: { paymentId: payment?.id ?? null, reference: event.data.reference },
      })

      return { processed: true, paymentId: payment?.id ?? null }
    }

    if (event.event === 'charge.failed') {
      await db
        .update(payments)
        .set({ status: PaymentStatus.FAILED, updatedAt: new Date() })
        .where(eq(payments.paystackReference, event.data.reference))

      // Fire-and-forget: notify superadmin of failed payment
      notificationsService.notifyRole({
        targetRole: UserRole.STAFF,
        type: 'payment_failed',
        title: 'Payment Failed',
        body: `Payment failed for reference ${event.data.reference}`,
        metadata: { reference: event.data.reference },
      })

      return { processed: true }
    }

    // Unhandled event type — acknowledge but take no action
    return { processed: false, reason: `Unhandled event type: ${event.event}` }
  }

  async getPaymentById(id: string) {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1)

    return payment ?? null
  }

  async getPaymentByReference(reference: string) {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.paystackReference, reference))
      .limit(1)

    return payment ?? null
  }

  async listPayments(
    params: PaginationParams & { userId?: string; status?: PaymentStatus },
  ) {
    const offset = getPaginationOffset(params.page, params.limit)

    const conditions = [
      params.userId ? eq(payments.userId, params.userId) : undefined,
      params.status ? eq(payments.status, params.status) : undefined,
    ].filter(Boolean)

    const baseWhere =
      conditions.length > 0
        ? and(...(conditions as NonNullable<(typeof conditions)[0]>[]))
        : undefined

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(payments)
        .where(baseWhere)
        .orderBy(desc(payments.createdAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .where(baseWhere),
    ])

    const total = countResult[0]?.count ?? 0
    return buildPaginatedResult(data, total, params)
  }

  private mapPaystackStatus(paystackStatus: string): PaymentStatus {
    switch (paystackStatus) {
      case 'success':
        return PaymentStatus.SUCCESSFUL
      case 'failed':
        return PaymentStatus.FAILED
      case 'abandoned':
        return PaymentStatus.ABANDONED
      default:
        return PaymentStatus.PENDING
    }
  }
}

export const paymentsService = new PaymentsService()
