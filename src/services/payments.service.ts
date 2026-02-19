import { createHmac } from 'crypto'
import { eq, and, desc, sql } from 'drizzle-orm'
import axios from 'axios'
import { db } from '../config/db'
import { payments } from '../../drizzle/schema'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { env } from '../config/env'
import type { PaginationParams } from '../types'
import { PaymentStatus } from '../types/enums'

const PAYSTACK_API = 'https://api.paystack.co'

export interface InitializePaymentInput {
  orderId: string
  userId: string
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

export class PaymentsService {
  async initializePayment(input: InitializePaymentInput) {
    const { orderId, userId, amount, email, callbackUrl, metadata } = input
    const currency = input.currency ?? 'NGN'

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
        orderId,
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

    return updated ?? null
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

      return { processed: true, paymentId: payment?.id ?? null }
    }

    if (event.event === 'charge.failed') {
      await db
        .update(payments)
        .set({ status: PaymentStatus.FAILED, updatedAt: new Date() })
        .where(eq(payments.paystackReference, event.data.reference))

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
