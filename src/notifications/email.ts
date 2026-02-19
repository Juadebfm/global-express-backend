import sgMail from '@sendgrid/mail'
import { env } from '../config/env'

sgMail.setApiKey(env.SENDGRID_API_KEY)

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
}

async function sendEmail(params: SendEmailParams): Promise<void> {
  const { to, subject, html, text } = params

  await sgMail.send({
    to,
    from: {
      email: env.SENDGRID_FROM_EMAIL,
      name: env.SENDGRID_FROM_NAME,
    },
    subject,
    html,
    ...(text ? { text } : {}),
  })
}

export async function sendOrderConfirmationEmail(params: {
  to: string
  recipientName: string
  trackingNumber: string
  origin: string
  destination: string
}): Promise<void> {
  const { to, recipientName, trackingNumber, origin, destination } = params

  await sendEmail({
    to,
    subject: `Order Confirmed — Tracking #${trackingNumber}`,
    html: `
      <h2>Your shipment order has been confirmed!</h2>
      <p>Hi ${recipientName},</p>
      <p>Your order has been placed and is being processed.</p>
      <ul>
        <li><strong>Tracking Number:</strong> ${trackingNumber}</li>
        <li><strong>From:</strong> ${origin}</li>
        <li><strong>To:</strong> ${destination}</li>
      </ul>
      <p>You will receive updates as your shipment progresses.</p>
    `,
    text: `Order Confirmed — Tracking #${trackingNumber}\n\nHi ${recipientName},\nFrom: ${origin}\nTo: ${destination}`,
  })
}

export async function sendOrderStatusUpdateEmail(params: {
  to: string
  recipientName: string
  trackingNumber: string
  status: string
}): Promise<void> {
  const { to, recipientName, trackingNumber, status } = params
  const statusLabel = status.replace(/_/g, ' ').toUpperCase()

  await sendEmail({
    to,
    subject: `Shipment Update — Tracking #${trackingNumber}`,
    html: `
      <h2>Shipment Status Update</h2>
      <p>Hi ${recipientName},</p>
      <p>Your shipment <strong>#${trackingNumber}</strong> has been updated to: <strong>${statusLabel}</strong></p>
    `,
    text: `Shipment #${trackingNumber} is now: ${statusLabel}`,
  })
}

export async function sendAccountAlertEmail(params: {
  to: string
  subject: string
  message: string
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: params.subject,
    html: `<p>${params.message}</p>`,
    text: params.message,
  })
}
