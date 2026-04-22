import { Resend } from 'resend'
import { env } from '../config/env'
import { settingsTemplatesService } from '../services/settings-templates.service'
import type { PreferredLanguage } from '../types/enums'

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function plainTextToHtml(message: string): string {
  return message
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('')
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
  /** V2 status string — used as fallback label when no DB template is found */
  status: string
  /** Template key in notification_templates (e.g. "order.warehouse_verified_priced") */
  templateKey?: string
  /** Recipient's preferred language — defaults to 'en' */
  locale?: PreferredLanguage
}): Promise<void> {
  const { to, recipientName, trackingNumber } = params
  const locale = params.locale ?? ('en' as PreferredLanguage)
  const vars: Record<string, string> = { trackingNumber, recipientName }
  const render = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => vars[key] ?? `{{${key}}}`)

  let subject: string
  let html: string
  let text: string

  const tmpl = params.templateKey
    ? await settingsTemplatesService.getTemplate(params.templateKey, locale, 'email')
    : null

  if (tmpl) {
    subject = tmpl.subject ? render(tmpl.subject) : `Shipment Update — Tracking #${trackingNumber}`
    html = render(tmpl.body)
    text = html.replace(/<[^>]+>/g, '').trim()
  } else {
    const statusLabel = params.status.replace(/_/g, ' ').toUpperCase()
    subject = `Shipment Update — Tracking #${trackingNumber}`
    html = `
      <h2>Shipment Status Update</h2>
      <p>Hi ${recipientName},</p>
      <p>Your shipment <strong>#${trackingNumber}</strong> has been updated to: <strong>${statusLabel}</strong></p>
    `
    text = `Shipment #${trackingNumber} is now: ${statusLabel}`
  }

  await sendEmail({ to, subject, html, text })
}

export async function sendAccountAlertEmail(params: {
  to: string
  subject: string
  message: string
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: params.subject,
    html: plainTextToHtml(params.message),
    text: params.message,
  })
}

export async function sendWelcomeCredentialsEmail(params: {
  to: string
  firstName: string
  role: string
  temporaryPassword: string
  loginUrl: string
}): Promise<void> {
  const { to, firstName, role, temporaryPassword, loginUrl } = params

  await sendEmail({
    to,
    subject: 'Your Global Express Staff Account Has Been Created',
    html: `
      <h2>Welcome to Global Express!</h2>
      <p>Hi ${firstName},</p>
      <p>A <strong>${role}</strong> account has been created for you. Here are your login credentials:</p>
      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px; font-weight: bold;">Email:</td><td style="padding: 8px;">${to}</td></tr>
        <tr><td style="padding: 8px; font-weight: bold;">Temporary Password:</td><td style="padding: 8px; font-family: monospace; font-size: 18px; letter-spacing: 2px;">${temporaryPassword}</td></tr>
      </table>
      <p><strong>You will be required to change your password on first login.</strong></p>
      <p><a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Log In Now</a></p>
      <p style="color: #666; font-size: 13px;">If you did not expect this email, please contact your administrator.</p>
    `,
    text: `Welcome to Global Express!\n\nHi ${firstName},\nA ${role} account has been created for you.\n\nEmail: ${to}\nTemporary Password: ${temporaryPassword}\n\nYou will be required to change your password on first login.\n\nLog in at: ${loginUrl}`,
  })
}

export async function sendClientLoginLinkEmail(params: {
  to: string
  recipientName: string
  loginLink: string
}): Promise<void> {
  const { to, recipientName, loginLink } = params

  await sendEmail({
    to,
    subject: 'Your Global Express Login Link',
    html: `
      <h2>Your Login Link Is Ready</h2>
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>Your Global Express account has been prepared by our team. Use the secure link below to access your account and complete your onboarding:</p>
      <p><a href="${escapeHtml(loginLink)}" style="display: inline-block; padding: 12px 24px; background: #1d4ed8; color: #fff; text-decoration: none; border-radius: 6px;">Open Login Link</a></p>
      <p style="color: #666; font-size: 13px;">If you did not request this, please contact support immediately.</p>
    `,
    text: `Hi ${recipientName},\n\nYour Global Express account is ready.\nUse this secure login link to access your account:\n${loginLink}\n\nIf you did not request this, please contact support immediately.`,
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

export async function sendSupplierInvoiceEmail(params: {
  to: string
  supplierName: string
  invoiceNumber: string
  trackingNumber: string
  status: string
  totalUsd: string | null
  totalNgn: string | null
  note?: string | null
  attachmentUrls?: string[]
}): Promise<void> {
  const attachmentSection =
    (params.attachmentUrls?.length ?? 0) > 0
      ? `
      <p><strong>Attached invoice files:</strong></p>
      <ul>
        ${params.attachmentUrls?.map((url) => `<li><a href="${url}">${url}</a></li>`).join('') ?? ''}
      </ul>
    `
      : '<p>No task-invoice attachment links were included in this dispatch.</p>'

  const noteSection = params.note?.trim()
    ? `<p><strong>Note from team:</strong> ${escapeHtml(params.note.trim())}</p>`
    : ''

  const statusLabel = params.status.toUpperCase()

  await sendEmail({
    to: params.to,
    subject: `Supplier Invoice Shared — ${params.invoiceNumber}`,
    html: `
      <h2>Invoice Shared</h2>
      <p>Hi ${escapeHtml(params.supplierName)},</p>
      <p>An invoice has been shared with you for shipment <strong>${escapeHtml(params.trackingNumber)}</strong>.</p>
      <ul>
        <li><strong>Invoice Number:</strong> ${escapeHtml(params.invoiceNumber)}</li>
        <li><strong>Status:</strong> ${escapeHtml(statusLabel)}</li>
        <li><strong>Total (USD):</strong> ${escapeHtml(params.totalUsd ?? 'N/A')}</li>
        <li><strong>Total (NGN):</strong> ${escapeHtml(params.totalNgn ?? 'N/A')}</li>
      </ul>
      ${noteSection}
      ${attachmentSection}
      <p>Please contact support if you need help with this invoice.</p>
    `,
    text: [
      `Hi ${params.supplierName},`,
      '',
      `Invoice ${params.invoiceNumber} has been shared with you for shipment ${params.trackingNumber}.`,
      `Status: ${statusLabel}`,
      `Total (USD): ${params.totalUsd ?? 'N/A'}`,
      `Total (NGN): ${params.totalNgn ?? 'N/A'}`,
      params.note?.trim() ? `Note: ${params.note.trim()}` : '',
      '',
      (params.attachmentUrls?.length ?? 0) > 0
        ? `Files:\n${params.attachmentUrls?.join('\n') ?? ''}`
        : 'No task-invoice attachment links were included in this dispatch.',
      '',
      'Please contact support if you need help with this invoice.',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  })
}
