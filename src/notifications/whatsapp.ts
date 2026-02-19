import axios from 'axios'
import { env } from '../config/env'

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`

interface SendTextMessageParams {
  /** Phone number with country code, no '+' prefix. E.g. "2348012345678" */
  to: string
  message: string
}

async function sendWhatsAppTextMessage(params: SendTextMessageParams): Promise<void> {
  await axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: 'whatsapp',
      to: params.to,
      type: 'text',
      text: { body: params.message },
    },
    {
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    },
  )
}

export async function sendOrderStatusWhatsApp(params: {
  phone: string
  recipientName: string
  trackingNumber: string
  status: string
}): Promise<void> {
  const { phone, recipientName, trackingNumber, status } = params
  const statusLabel = status.replace(/_/g, ' ').toUpperCase()

  await sendWhatsAppTextMessage({
    to: phone,
    message: `Hi ${recipientName}! Your shipment *#${trackingNumber}* has been updated to: *${statusLabel}*.\n\nTrack your shipment for more details.`,
  })
}

export async function sendOrderConfirmationWhatsApp(params: {
  phone: string
  recipientName: string
  trackingNumber: string
  origin: string
  destination: string
}): Promise<void> {
  const { phone, recipientName, trackingNumber, origin, destination } = params

  await sendWhatsAppTextMessage({
    to: phone,
    message: `Hi ${recipientName}! Your shipment order has been confirmed.\n\n*Tracking Number:* ${trackingNumber}\n*From:* ${origin}\n*To:* ${destination}\n\nWe will keep you updated!`,
  })
}
