import { Resend } from 'resend'
import { env } from '../config/env'

const resend = new Resend(env.RESEND_API_KEY)

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
}

async function sendEmail(params: SendEmailParams): Promise<void> {
  const { to, subject, html, text } = params

  await resend.emails.send({
    from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
    to,
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

export async function sendPasswordResetOtpEmail(params: {
  to: string
  otp: string
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: 'Your Password Reset Code',
    html: `
      <h2>Password Reset Request</h2>
      <p>Use the code below to reset your password. It expires in <strong>10 minutes</strong>.</p>
      <h1 style="letter-spacing: 8px; font-size: 36px;">${params.otp}</h1>
      <p>If you did not request a password reset, ignore this email.</p>
    `,
    text: `Your password reset code is: ${params.otp}\n\nIt expires in 10 minutes.`,
  })
}
