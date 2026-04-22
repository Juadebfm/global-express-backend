import axios from 'axios'
import { env } from '../config/env'

const TERMII_API_URL = 'https://v3.api.termii.com/api/sms/send'

function isTermiiConfigured(): boolean {
  return !!env.TERMII_API_KEY
}

async function sendPhoneNotification(to: string, message: string): Promise<void> {
  if (!isTermiiConfigured()) return

  await axios.post(TERMII_API_URL, {
    api_key: env.TERMII_API_KEY,
    to,
    from: env.TERMII_SENDER_ID ?? 'talert',
    sms: message,
    type: 'plain',
    // 'whatsapp' when WhatsApp registration is done, otherwise 'generic' SMS
    channel: env.TERMII_CHANNEL ?? 'generic',
  })
}

export async function sendOrderStatusWhatsApp(params: {
  phone: string
  recipientName: string
  trackingNumber: string
  status: string
}): Promise<void> {
  const { phone, recipientName, trackingNumber, status } = params
  const statusLabel = status.replace(/_/g, ' ').toUpperCase()

  await sendPhoneNotification(
    phone,
    `Hi ${recipientName}! Your shipment #${trackingNumber} has been updated to: ${statusLabel}. Track your shipment for more details.`,
  )
}

export async function sendOrderConfirmationWhatsApp(params: {
  phone: string
  recipientName: string
  trackingNumber: string
  origin: string
  destination: string
}): Promise<void> {
  const { phone, recipientName, trackingNumber, origin, destination } = params

  await sendPhoneNotification(
    phone,
    `Hi ${recipientName}! Your shipment order has been confirmed.\nTracking Number: ${trackingNumber}\nFrom: ${origin}\nTo: ${destination}\nWe will keep you updated!`,
  )
}

export async function sendClientLoginLinkWhatsApp(params: {
  phone: string
  recipientName: string
  loginLink: string
}): Promise<void> {
  const { phone, recipientName, loginLink } = params

  await sendPhoneNotification(
    phone,
    `Hi ${recipientName}! Your Global Express account is ready. Use this secure login link to access your account:\n${loginLink}`,
  )
}

export async function sendSupplierInvoiceWhatsApp(params: {
  phone: string
  recipientName: string
  invoiceNumber: string
  trackingNumber: string
  totalUsd: string | null
  status: string
  attachmentUrl?: string | null
}): Promise<void> {
  const statusLabel = params.status.toUpperCase()
  const attachmentLine = params.attachmentUrl ? `\nInvoice file: ${params.attachmentUrl}` : ''

  await sendPhoneNotification(
    params.phone,
    `Hi ${params.recipientName}! Invoice ${params.invoiceNumber} for shipment ${params.trackingNumber} has been shared with you.\nStatus: ${statusLabel}\nTotal (USD): ${params.totalUsd ?? 'N/A'}${attachmentLine}`,
  )
}
