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
