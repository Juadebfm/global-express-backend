import { createHmac } from 'crypto'
import { eq, and, desc, sql, isNull, getTableColumns } from 'drizzle-orm'
import { paystackClient } from '../config/http-clients'
import { db } from '../config/db'
import { avScanService } from './av-scan.service'
import { payments, orders, invoices } from '../../drizzle/schema'
import { notificationsService, notifyUser } from './notifications.service'
import { dispatchBatchesService } from './dispatch-batches.service'
import { PaymentCollectionStatus, UserRole } from '../types/enums'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { env } from '../config/env'
import type { PaginationParams } from '../types'
import { PaymentStatus, PaymentType } from '../types/enums'
import { uploadsService } from './uploads.service'
import { settingsFxRateService } from './settings-fx-rate.service'

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
  orderId: string
  userId: string
  requesterRole: UserRole
  contentType: string
  originalFileName?: string
}

export interface SubmitPaymentReceiptInput {
  orderId: string
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
  trackingNumber: string
  senderId: string
  billingSupplierId: string | null
  invoiceId: string
  billToUserId: string | null
  billToSupplierId: string | null
}

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

/**
 * Open-redirect guard for the Paystack `callback_url`. Paystack will redirect the
 * customer's browser to this URL after payment, so an unvalidated value lets an
 * attacker host a phishing page that looks like it came from our domain.
 *
 * We only accept URLs whose origin matches one of the entries in CORS_ORIGINS.
 */
function assertCallbackUrlIsAllowed(callbackUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(callbackUrl)
  } catch {
    throw httpError('callbackUrl is not a valid URL', 422)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw httpError('callbackUrl must use http(s)', 422)
  }

  const allowedOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  if (!allowedOrigins.includes(parsed.origin)) {
    throw httpError(
      `callbackUrl origin "${parsed.origin}" is not in the allowed list`,
      422,
    )
  }
}

export class PaymentsService {
  async initializePayment(input: InitializePaymentInput) {
    const { userId, requesterRole, amount, email, callbackUrl, metadata } = input
    const currency = input.currency ?? 'NGN'

    // Open-redirect guard — Paystack redirects the browser here after payment.
    if (callbackUrl) {
      assertCallbackUrlIsAllowed(callbackUrl)
    }

    const target = await this.resolvePaymentTarget({
      orderId: input.orderId,
    })

    this.assertPaymentOwnership({
      requesterId: userId,
      requesterRole,
      target,
    })

    const response = await paystackClient.post<PaystackInitializeResponse>(
      '/transaction/initialize',
      {
        email,
        amount, // Paystack expects amount in kobo
        currency,
        callback_url: callbackUrl,
        metadata,
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
      payment: { ...payment, trackingNumber: target.trackingNumber },
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

    // Fire-and-forget AV scan of the receipt (V12.4.1). Staff "verify receipt"
    // UI must check the scan status before opening the file.
    void avScanService.scheduleScan({
      r2Key: input.r2Key,
      scope: 'payments/receipt',
      scopeId: target.orderId,
    })

    void notificationsService.notifyRole({
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

    return { ...payment, trackingNumber: target.trackingNumber }
  }

  async getTotalPaidUsdForOrder(orderId: string): Promise<number> {
    const [fxRate, rows] = await Promise.all([
      settingsFxRateService.getEffectiveRate().catch(() => 1500),
      db
        .select({ amount: payments.amount, currency: payments.currency })
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.status, PaymentStatus.SUCCESSFUL))),
    ])
    return rows.reduce((sum, row) => {
      const val = parseFloat(row.amount)
      return Number.isFinite(val) ? sum + (row.currency.toUpperCase() === 'USD' ? val : val / fxRate) : sum
    }, 0)
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

    let warning: string | null = null

    if (isApproved) {
      const [orderData] = await db
        .select({ finalChargeUsd: orders.finalChargeUsd })
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .limit(1)

      const finalCharge = orderData?.finalChargeUsd ? parseFloat(orderData.finalChargeUsd) : null
      const totalPaidUsd = await this.getTotalPaidUsdForOrder(payment.orderId)

      let newStatus: PaymentCollectionStatus
      if (finalCharge === null) {
        newStatus = PaymentCollectionStatus.PAID_IN_FULL
        warning = 'Order has no confirmed price yet. Payment accepted — final charge will be set after warehouse verification.'
      } else if (totalPaidUsd >= finalCharge) {
        newStatus = PaymentCollectionStatus.PAID_IN_FULL
      } else {
        newStatus = PaymentCollectionStatus.PAYMENT_IN_PROGRESS
        const remaining = (finalCharge - totalPaidUsd).toFixed(2)
        warning = `Payment partially covers the order total. $${remaining} USD still outstanding.`
      }

      await db
        .update(orders)
        .set({ paymentCollectionStatus: newStatus, updatedAt: now })
        .where(eq(orders.id, payment.orderId))

      if (newStatus === PaymentCollectionStatus.PAID_IN_FULL) {
        await dispatchBatchesService.markInvoicePaidByOrder({
          orderId: payment.orderId,
          actorId: input.verifiedBy,
          paidAt: updated.paidAt,
        })
      }

      void notificationsService.notifyRole({
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

      void notificationsService.notifyRole({
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

    const [orderRow] = await db
      .select({ trackingNumber: orders.trackingNumber })
      .from(orders)
      .where(eq(orders.id, updated.orderId))
      .limit(1)

    return { ...updated, trackingNumber: orderRow?.trackingNumber ?? '', warning }
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
        trackingNumber: orders.trackingNumber,
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
      trackingNumber: order.trackingNumber,
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
    const response = await paystackClient.get<PaystackVerifyResponse>(
      `/transaction/verify/${reference}`,
    )

    if (!response.data.status) {
      throw new Error(`Paystack verification failed: ${response.data.message}`)
    }

    const paystackData = response.data.data
    const newStatus = this.mapPaystackStatus(paystackData.status)
    const transactionId = String(paystackData.id)

    // Idempotency (V11.1.4): if the payment is already SUCCESSFUL with the same
    // transaction id, return it without re-firing downstream side effects.
    const [existing] = await db
      .select({
        id: payments.id,
        status: payments.status,
        paystackTransactionId: payments.paystackTransactionId,
      })
      .from(payments)
      .where(eq(payments.paystackReference, reference))
      .limit(1)

    if (
      existing?.status === PaymentStatus.SUCCESSFUL &&
      existing.paystackTransactionId === transactionId
    ) {
      const [current] = await db
        .select({ ...getTableColumns(payments), trackingNumber: orders.trackingNumber })
        .from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .where(eq(payments.id, existing.id))
        .limit(1)
      return current ?? null
    }

    const [updated] = await db
      .update(payments)
      .set({
        status: newStatus,
        paystackTransactionId: transactionId,
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

    if (!updated) return null
    const [orderRow] = await db
      .select({ trackingNumber: orders.trackingNumber })
      .from(orders)
      .where(eq(orders.id, updated.orderId))
      .limit(1)
    return { ...updated, trackingNumber: orderRow?.trackingNumber ?? '' }
  }

  async recordOfflinePayment(input: {
    orderId?: string
    invoiceId?: string
    userId: string
    recordedBy: string
    amount: number
    currency?: string
    paymentType: PaymentType.TRANSFER | PaymentType.CASH
    proofReference?: string
    note?: string
  }) {
    const target = await this.resolvePaymentTarget({
      orderId: input.orderId,
      invoiceId: input.invoiceId,
    })
    const resolvedOrderId = target.orderId
    const currency = (input.currency ?? 'NGN').toUpperCase()

    const [order] = await db
      .select({ finalChargeUsd: orders.finalChargeUsd, calculatedChargeUsd: orders.calculatedChargeUsd })
      .from(orders)
      .where(and(eq(orders.id, resolvedOrderId), isNull(orders.deletedAt)))

    if (!order) {
      throw httpError('Order not found', 404)
    }

    if (input.amount <= 0) {
      throw httpError('Payment amount must be greater than zero', 400)
    }

    // Sanity check: catch obvious typos (e.g. extra zeros)
    const orderCharge = parseFloat(order.finalChargeUsd ?? order.calculatedChargeUsd ?? '0')
    if (orderCharge > 0) {
      const limit = currency === 'USD' ? orderCharge * 3 : orderCharge * 3000
      if (input.amount > limit) {
        throw httpError('Payment amount appears unreasonably high for this order', 400)
      }
    }

    const [payment] = await db
      .insert(payments)
      .values({
        orderId: resolvedOrderId,
        invoiceId: target.invoiceId,
        userId: input.userId,
        amount: String(input.amount),
        currency,
        status: PaymentStatus.SUCCESSFUL,
        paymentType: input.paymentType,
        recordedBy: input.recordedBy,
        proofReference: input.proofReference ?? null,
        note: input.note ?? null,
        paidAt: new Date(),
      })
      .returning()

    const finalCharge = order.finalChargeUsd ? parseFloat(order.finalChargeUsd) : null
    const totalPaidUsd = await this.getTotalPaidUsdForOrder(resolvedOrderId)

    let newStatus: PaymentCollectionStatus
    let warning: string | null = null

    if (finalCharge === null) {
      newStatus = PaymentCollectionStatus.PAID_IN_FULL
      warning = 'Order has no confirmed price yet. Payment recorded — final charge will be set after warehouse verification.'
    } else if (totalPaidUsd >= finalCharge) {
      newStatus = PaymentCollectionStatus.PAID_IN_FULL
    } else {
      newStatus = PaymentCollectionStatus.PAYMENT_IN_PROGRESS
      const remaining = (finalCharge - totalPaidUsd).toFixed(2)
      warning = `Payment partially covers the order total. $${remaining} USD still outstanding.`
    }

    await db
      .update(orders)
      .set({ paymentCollectionStatus: newStatus, updatedAt: new Date() })
      .where(eq(orders.id, resolvedOrderId))

    if (newStatus === PaymentCollectionStatus.PAID_IN_FULL) {
      await dispatchBatchesService.markInvoicePaidByOrder({
        orderId: resolvedOrderId,
        actorId: input.recordedBy,
        paidAt: payment.paidAt,
      })
    }

    void notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'payment_received',
      title: 'Offline Payment Recorded',
      body: `${currency} ${input.amount} recorded for order ${resolvedOrderId}.`,
      metadata: { paymentId: payment.id, orderId: resolvedOrderId },
    })

    return { ...payment, trackingNumber: target.trackingNumber, warning }
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
      // Idempotency: Paystack's signing scheme has no timestamp, so a replayed
      // signature is indistinguishable from a fresh one. Reject if we've already
      // recorded a SUCCESSFUL payment for this transaction id.
      const transactionId = String(event.data.id)
      const [existing] = await db
        .select({ id: payments.id, status: payments.status, paystackTransactionId: payments.paystackTransactionId })
        .from(payments)
        .where(eq(payments.paystackReference, event.data.reference))
        .limit(1)

      if (
        existing?.status === PaymentStatus.SUCCESSFUL &&
        existing.paystackTransactionId === transactionId
      ) {
        return { processed: false, paymentId: existing.id, reason: 'duplicate_event' }
      }

      const [payment] = await db
        .update(payments)
        .set({
          status: PaymentStatus.SUCCESSFUL,
          paystackTransactionId: transactionId,
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
      void notificationsService.notifyRole({
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
      void notificationsService.notifyRole({
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
      .select({ ...getTableColumns(payments), trackingNumber: orders.trackingNumber })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(eq(payments.id, id))
      .limit(1)

    return payment ?? null
  }

  async getPaymentByReference(reference: string) {
    const [payment] = await db
      .select({ ...getTableColumns(payments), trackingNumber: orders.trackingNumber })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(eq(payments.paystackReference, reference))
      .limit(1)

    return payment ?? null
  }

  async listPaymentsForOrder(orderId: string) {
    return db
      .select({ ...getTableColumns(payments), trackingNumber: orders.trackingNumber })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(eq(payments.orderId, orderId))
      .orderBy(desc(payments.createdAt))
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
        .select({ ...getTableColumns(payments), trackingNumber: orders.trackingNumber })
        .from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
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
