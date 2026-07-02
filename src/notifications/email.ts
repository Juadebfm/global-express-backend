import { Resend } from 'resend'
import { env } from '../config/env'
import { settingsTemplatesService } from '../services/settings-templates.service'
import type { PreferredLanguage } from '../types/enums'

const resend = new Resend(env.RESEND_API_KEY)

// Resolved once at startup — falls back to the standard R2 brand folder.
const LOGO_URL = env.EMAIL_LOGO_URL ?? `${env.R2_PUBLIC_URL}/brand/gexlogo.png`
const BRAND_ORANGE = '#f97316'
const DARK = '#111827'
const MUTED = '#6b7280'
const BORDER = '#e5e7eb'
const BG = '#f3f4f6'
const CARD_BG = '#ffffff'

// ─── Primitives ───────────────────────────────────────────────────────────────

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

// ─── Layout helpers ───────────────────────────────────────────────────────────

/**
 * Wraps `content` in the Global Express branded email shell.
 * `preheader` is the short preview text shown in inbox lists before opening.
 */
function renderEmailBase(preheader: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Global Express</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!--[if mso]><table width="100%"><tr><td><![endif]-->
  <!-- Preheader — hidden preview text shown in inbox list -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:${BG};">
    ${escapeHtml(preheader)}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:${BG};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" role="presentation"
          style="max-width:560px;width:100%;background:${CARD_BG};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.10);">

          <!-- Header -->
          <tr>
            <td style="background:${DARK};padding:28px 32px;text-align:center;">
              <img src="${LOGO_URL}" alt="Global Express" width="130" height="auto"
                style="display:block;margin:0 auto;max-width:130px;height:auto;border:0;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 28px;">
              <div style="color:${DARK};font-size:15px;line-height:1.65;">
                ${content}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid ${BORDER};padding:20px 32px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;line-height:1.6;">
                <strong style="color:#6b7280;">Global Express</strong> &nbsp;·&nbsp; Korea ↔ Nigeria logistics
              </p>
              <p style="margin:0;font-size:11px;color:#d1d5db;line-height:1.6;">
                If you didn't expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>

        <!-- Below-card spacer / legal -->
        <p style="margin:20px 0 0;font-size:11px;color:#9ca3af;text-align:center;">
          © Global Express · <a href="https://globalexpress.kr" style="color:#9ca3af;text-decoration:underline;">globalexpress.kr</a>
        </p>
      </td>
    </tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`
}

/** Orange pill CTA button, centred. */
function ctaButton(label: string, url: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:28px 0 4px;">
      <tr>
        <td align="center">
          <a href="${escapeHtml(url)}"
            style="display:inline-block;padding:13px 32px;background:${BRAND_ORANGE};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;letter-spacing:0.01em;mso-padding-alt:0;text-align:center;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`
}

/** Label / value data table — used across multiple email types. */
function dataTable(rows: [string, string][]): string {
  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:9px 20px 9px 0;color:${MUTED};white-space:nowrap;vertical-align:top;font-size:13.5px;border-bottom:1px solid #f3f4f6;">${escapeHtml(label)}</td>
          <td style="padding:9px 0;font-weight:500;font-size:13.5px;color:${DARK};border-bottom:1px solid #f3f4f6;">${value}</td>
        </tr>`,
    )
    .join('')
  return `<table style="border-collapse:collapse;width:100%;margin:20px 0 24px;" cellpadding="0" cellspacing="0" border="0" role="presentation">${rowsHtml}</table>`
}

/** Section heading inside a card body. */
function heading(text: string): string {
  return `<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${DARK};letter-spacing:-0.01em;">${escapeHtml(text)}</h2>`
}

/** Standard body paragraph. */
function para(html: string, style = ''): string {
  return `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.65;${style}">${html}</p>`
}

/** Converts plain text (newlines) to styled paragraphs for use in renderEmailBase. */
function plainToContent(message: string): string {
  return message
    .trim()
    .split(/\n{2,}/)
    .map((block) =>
      para(block.split('\n').map(escapeHtml).join('<br />')),
    )
    .join('')
}

/** Alert / info box — e.g. remaining balance, warning. */
function alertBox(html: string, tone: 'warn' | 'success' | 'info' = 'info'): string {
  const bg = tone === 'warn' ? '#fef3c7' : tone === 'success' ? '#dcfce7' : '#eff6ff'
  const border = tone === 'warn' ? '#fcd34d' : tone === 'success' ? '#86efac' : '#93c5fd'
  const color = tone === 'warn' ? '#92400e' : tone === 'success' ? '#166534' : '#1e40af'
  return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:14px 16px;margin:16px 0;font-size:14px;color:${color};line-height:1.5;">${html}</div>`
}

/** OTP / code display block. */
function codeBlock(code: string): string {
  return `
    <div style="text-align:center;margin:28px 0;">
      <span style="display:inline-block;font-size:38px;font-weight:700;letter-spacing:10px;color:${DARK};font-family:'Courier New',Courier,monospace;background:#f3f4f6;padding:16px 28px;border-radius:10px;border:1px solid ${BORDER};">
        ${escapeHtml(code)}
      </span>
    </div>`
}

// ─── Email functions ───────────────────────────────────────────────────────────

export async function sendOrderConfirmationEmail(params: {
  to: string
  recipientName: string
  trackingNumber: string
  origin: string
  destination: string
}): Promise<void> {
  const { to, recipientName, trackingNumber, origin, destination } = params

  const content = [
    heading('Your order is confirmed'),
    para(`Hi ${escapeHtml(recipientName)},`),
    para('Your shipment has been placed and is being processed. We\'ll send you updates as it moves through our network.'),
    dataTable([
      ['Tracking number', escapeHtml(trackingNumber)],
      ['From', escapeHtml(origin)],
      ['To', escapeHtml(destination)],
    ]),
    para(`<span style="color:${MUTED};font-size:13px;">Keep this tracking number safe — you'll need it to follow your shipment.</span>`),
  ].join('')

  await sendEmail({
    to,
    subject: `Order Confirmed — #${trackingNumber}`,
    html: renderEmailBase(`Your order #${trackingNumber} has been confirmed.`, content),
    text: `Order Confirmed — #${trackingNumber}\n\nHi ${recipientName},\nFrom: ${origin}\nTo: ${destination}\n\nTracking: ${trackingNumber}`,
  })
}

export async function sendOrderStatusUpdateEmail(params: {
  to: string
  recipientName: string
  trackingNumber: string
  status: string
  templateKey?: string
  locale?: PreferredLanguage
}): Promise<void> {
  const { to, recipientName, trackingNumber } = params
  const locale = params.locale ?? ('en' as PreferredLanguage)
  const vars: Record<string, string> = { trackingNumber, recipientName }
  const render = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => vars[key] ?? `{{${key}}}`)

  let subject: string
  let bodyContent: string
  let text: string

  const tmpl = params.templateKey
    ? await settingsTemplatesService.getTemplate(params.templateKey, locale, 'email')
    : null

  if (tmpl) {
    subject = tmpl.subject ? render(tmpl.subject) : `Shipment Update — #${trackingNumber}`
    // Strip any full-document wrapper a DB template might include so we don't
    // nest a complete <html> document inside renderEmailBase.
    const rawBody = render(tmpl.body)
    bodyContent = rawBody.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body[\s\S]*$/i, '') || rawBody
    text = bodyContent.replace(/<[^>]+>/g, '').trim()
  } else {
    const statusLabel = params.status.replace(/_/g, ' ')
    subject = `Shipment Update — #${trackingNumber}`
    bodyContent = [
      heading('Shipment update'),
      para(`Hi ${escapeHtml(recipientName)},`),
      para(`Your shipment <strong>#${escapeHtml(trackingNumber)}</strong> has been updated:`),
      `<p style="margin:16px 0;padding:14px 16px;background:#f3f4f6;border-radius:8px;font-size:15px;font-weight:600;color:${DARK};">${escapeHtml(statusLabel)}</p>`,
      para(`<span style="color:${MUTED};font-size:13px;">You'll receive another notification when the status changes again.</span>`),
    ].join('')
    text = `Shipment #${trackingNumber} is now: ${statusLabel}`
  }

  await sendEmail({
    to,
    subject,
    html: renderEmailBase(`Update on your shipment #${trackingNumber}`, bodyContent),
    text,
  })
}

export async function sendAccountAlertEmail(params: {
  to: string
  subject: string
  message: string
}): Promise<void> {
  const preheader = params.message.replace(/\s+/g, ' ').trim().slice(0, 100)
  await sendEmail({
    to: params.to,
    subject: params.subject,
    html: renderEmailBase(preheader, plainToContent(params.message)),
    text: params.message,
  })
}

export async function sendNewDeclarationAlertEmail(params: {
  to: string
  supplierName: string | null
  supplierBusiness: string | null
  description: string
  recipientName: string
  recipientPhone: string
  shipmentType: 'air' | 'ocean' | 'd2d'
  declaredValueUsd: string
  estimatedWeightKg: string | null
  estimatedArrivalAt: string | null
  declarationId: string
}): Promise<void> {
  const {
    supplierName, supplierBusiness, description, recipientName,
    recipientPhone, shipmentType, declaredValueUsd,
    estimatedWeightKg, estimatedArrivalAt, declarationId,
  } = params

  const shipmentLabels = { air: 'Air freight', ocean: 'Ocean freight', d2d: 'Door-to-door (D2D)' }
  const supplier = [supplierBusiness, supplierName].filter(Boolean).join(' — ') || 'Unknown supplier'

  const rows: [string, string][] = [
    ['Supplier', escapeHtml(supplier)],
    ['Goods', escapeHtml(description)],
    ['Recipient', `${escapeHtml(recipientName)} / ${escapeHtml(recipientPhone)}`],
    ['Shipment type', escapeHtml(shipmentLabels[shipmentType] ?? shipmentType)],
    ['Declared value', `USD ${escapeHtml(declaredValueUsd)}`],
    ...(estimatedWeightKg ? [['Est. weight', `${escapeHtml(estimatedWeightKg)} kg`] as [string, string]] : []),
    ...(estimatedArrivalAt ? [['Expected at warehouse', escapeHtml(estimatedArrivalAt)] as [string, string]] : []),
    ['Declaration ID', escapeHtml(declarationId)],
  ]

  const content = [
    heading('New goods notice'),
    para('A supplier has submitted a goods notice. Review and accept or reject it from the staff dashboard.'),
    dataTable(rows),
  ].join('')

  const text = [
    'New goods notice submitted.',
    '',
    ...rows.map(([l, v]) => `${l}: ${v}`),
    '',
    'Log in to accept or reject this declaration.',
  ].join('\n')

  await sendEmail({
    to: params.to,
    subject: '[Global Express] New supplier goods notice — action required',
    html: renderEmailBase('A new goods notice is waiting for your review.', content),
    text,
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

  const content = [
    heading(`Welcome to Global Express`),
    para(`Hi ${escapeHtml(firstName)},`),
    para(`A <strong>${escapeHtml(role)}</strong> account has been created for you. Use the credentials below to sign in — you'll be asked to set a new password on your first login.`),
    dataTable([
      ['Email', escapeHtml(to)],
      ['Temporary password', `<span style="font-family:'Courier New',Courier,monospace;font-size:16px;letter-spacing:2px;font-weight:700;">${escapeHtml(temporaryPassword)}</span>`],
    ]),
    ctaButton('Log in now', loginUrl),
    para(`<span style="color:${MUTED};font-size:13px;">If you didn't expect this, contact your administrator immediately.</span>`),
  ].join('')

  await sendEmail({
    to,
    subject: 'Your Global Express Staff Account',
    html: renderEmailBase('Your staff account credentials are ready.', content),
    text: `Welcome to Global Express!\n\nHi ${firstName},\nRole: ${role}\nEmail: ${to}\nTemporary password: ${temporaryPassword}\n\nLog in at: ${loginUrl}`,
  })
}

export async function sendClientLoginLinkEmail(params: {
  to: string
  recipientName: string
  loginLink: string
}): Promise<void> {
  const { to, recipientName, loginLink } = params

  const content = [
    heading('Your login link is ready'),
    para(`Hi ${escapeHtml(recipientName)},`),
    para('Your Global Express account has been set up. Click the button below to sign in and complete your onboarding.'),
    ctaButton('Open my account', loginLink),
    para(`<span style="color:${MUTED};font-size:13px;">This link is single-use. If you didn't request access, contact support immediately.</span>`),
  ].join('')

  await sendEmail({
    to,
    subject: 'Your Global Express Login Link',
    html: renderEmailBase('Your secure login link is ready.', content),
    text: `Hi ${recipientName},\n\nYour Global Express account is ready.\nSign in here: ${loginLink}\n\nIf you didn't request this, contact support immediately.`,
  })
}

export async function sendPickupReadyWithPinEmail(params: {
  to: string
  recipientName: string
  trackingNumber: string
  pin: string
}): Promise<void> {
  const content = [
    heading('Your shipment is ready for pickup'),
    para(`Hi ${escapeHtml(params.recipientName)},`),
    para(`Your shipment <strong>#${escapeHtml(params.trackingNumber)}</strong> is ready for pickup at our office. Your collection PIN is:`),
    codeBlock(params.pin),
    para('Please share this PIN with anyone collecting on your behalf.'),
  ].join('')

  await sendEmail({
    to: params.to,
    subject: `Your shipment ${params.trackingNumber} is ready for pickup — PIN: ${params.pin}`,
    html: renderEmailBase(`Your shipment #${params.trackingNumber} is ready for pickup.`, content),
    text: `Hi ${params.recipientName}, your shipment ${params.trackingNumber} is ready for pickup at our office. Your collection PIN is: ${params.pin}. Please share this with anyone collecting on your behalf.`,
  })
}

export async function sendPasswordResetOtpEmail(params: {
  to: string
  otp: string
}): Promise<void> {
  const content = [
    heading('Password reset code'),
    para('Use the code below to reset your password. It expires in <strong>10 minutes</strong>.'),
    codeBlock(params.otp),
    para(`<span style="color:${MUTED};font-size:13px;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</span>`),
  ].join('')

  await sendEmail({
    to: params.to,
    subject: 'Your Password Reset Code',
    html: renderEmailBase('Your one-time password reset code.', content),
    text: `Your password reset code is: ${params.otp}\n\nIt expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
  })
}

export async function sendPaymentRequestEmail(params: {
  to: string
  recipientName: string
  trackingNumber: string
  amountUsd: string
  amountNgn: string
  banks: Array<{ bankName: string; accounts: Array<{ currency: string; accountNumber: string }> }>
  beneficiaryName: string
}): Promise<void> {
  const { to, recipientName, trackingNumber, amountUsd, amountNgn, banks, beneficiaryName } = params

  const bankHtml = banks
    .map((b) => {
      const accounts = b.accounts
        .map((a) => `<div style="font-size:13.5px;color:${DARK};margin:3px 0;"><span style="color:${MUTED};">${escapeHtml(a.currency)}:</span> <strong>${escapeHtml(a.accountNumber)}</strong></div>`)
        .join('')
      return `<div style="margin:10px 0 6px;"><div style="font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${escapeHtml(b.bankName)}</div>${accounts}</div>`
    })
    .join('')

  const content = [
    heading('Payment details'),
    para(`Hi ${escapeHtml(recipientName)},`),
    para(`Your shipment <strong>#${escapeHtml(trackingNumber)}</strong> has been verified and priced. Here's what's due:`),
    dataTable([
      ['Amount (USD)', `<strong>$${escapeHtml(amountUsd)}</strong>`],
      ['Amount (NGN)', `<strong>₦${escapeHtml(amountNgn)}</strong>`],
      ['Pay to', escapeHtml(beneficiaryName)],
    ]),
    banks.length > 0
      ? `<div style="background:#f9fafb;border:1px solid ${BORDER};border-radius:8px;padding:16px 18px;margin:4px 0 20px;">
          <div style="font-size:12px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Bank accounts</div>
          ${bankHtml}
        </div>`
      : alertBox('No bank account details are available. Please contact support for payment instructions.', 'warn'),
    alertBox(`Use your tracking number <strong>#${escapeHtml(trackingNumber)}</strong> as the payment reference. You can pay now or when your goods arrive at our Lagos office.`, 'info'),
  ].join('')

  const text = [
    `Payment Details — Order ${trackingNumber}`,
    '',
    `Hi ${recipientName},`,
    `Amount: $${amountUsd} USD / ₦${amountNgn} NGN`,
    `Pay to: ${beneficiaryName}`,
    ...banks.flatMap((b) => [b.bankName, ...b.accounts.map((a) => `  ${a.currency}: ${a.accountNumber}`)]),
    '',
    'Use your tracking number as the payment reference.',
  ].join('\n')

  await sendEmail({
    to,
    subject: `Payment Details — Order ${trackingNumber}`,
    html: renderEmailBase(`Payment is due for your shipment #${trackingNumber}.`, content),
    text,
  })
}

export async function sendPaymentConfirmationEmail(params: {
  to: string
  recipientName: string
  trackingNumber: string
  amountPaid: string
  currency: string
  remainingBalanceUsd: string | null
}): Promise<void> {
  const { to, recipientName, trackingNumber, amountPaid, currency, remainingBalanceUsd } = params

  const hasBalance = remainingBalanceUsd && parseFloat(remainingBalanceUsd) > 0

  const content = [
    heading('Payment received'),
    para(`Hi ${escapeHtml(recipientName)},`),
    para(`We've received your <strong>${escapeHtml(currency)} ${escapeHtml(amountPaid)}</strong> payment for order <strong>#${escapeHtml(trackingNumber)}</strong>.`),
    hasBalance
      ? alertBox(`Outstanding balance: <strong>$${escapeHtml(remainingBalanceUsd!)} USD</strong> remaining on this order.`, 'warn')
      : alertBox('Your order is fully paid. Thank you!', 'success'),
    para(`<span style="color:${MUTED};font-size:13px;">Thank you for choosing Global Express.</span>`),
  ].join('')

  const text = [
    `Payment Confirmed — Order ${trackingNumber}`,
    '',
    `Hi ${recipientName},`,
    `We received ${currency} ${amountPaid} for order ${trackingNumber}.`,
    hasBalance ? `Outstanding balance: $${remainingBalanceUsd} USD` : 'Fully paid — thank you!',
  ].join('\n')

  await sendEmail({
    to,
    subject: `Payment Received — Order ${trackingNumber}`,
    html: renderEmailBase(`Payment confirmed for order #${trackingNumber}.`, content),
    text,
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
  const { supplierName, invoiceNumber, trackingNumber, status, totalUsd, totalNgn } = params
  const statusLabel = status.toUpperCase()

  const rows: [string, string][] = [
    ['Invoice number', escapeHtml(invoiceNumber)],
    ['Shipment', escapeHtml(trackingNumber)],
    ['Status', escapeHtml(statusLabel)],
    ['Total (USD)', escapeHtml(totalUsd ?? 'N/A')],
    ['Total (NGN)', escapeHtml(totalNgn ?? 'N/A')],
  ]

  const noteHtml = params.note?.trim()
    ? alertBox(`<strong>Note from team:</strong> ${escapeHtml(params.note.trim())}`, 'info')
    : ''

  const attachHtml =
    (params.attachmentUrls?.length ?? 0) > 0
      ? `<div style="margin:16px 0;">
          <div style="font-size:12px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Attached files</div>
          ${params.attachmentUrls!.map((url) => `<div style="margin:4px 0;"><a href="${escapeHtml(url)}" style="color:${BRAND_ORANGE};font-size:14px;text-decoration:underline;">${escapeHtml(url)}</a></div>`).join('')}
        </div>`
      : para(`<span style="color:${MUTED};font-size:13px;">No attachment links were included in this dispatch.</span>`)

  const content = [
    heading('Invoice shared with you'),
    para(`Hi ${escapeHtml(supplierName)},`),
    para(`An invoice has been shared with you for shipment <strong>${escapeHtml(trackingNumber)}</strong>.`),
    dataTable(rows),
    noteHtml,
    attachHtml,
    para(`<span style="color:${MUTED};font-size:13px;">Contact support if you need help with this invoice.</span>`),
  ].join('')

  const text = [
    `Hi ${supplierName},`,
    `Invoice ${invoiceNumber} for shipment ${trackingNumber}.`,
    `Status: ${statusLabel}`,
    `Total (USD): ${totalUsd ?? 'N/A'}`,
    `Total (NGN): ${totalNgn ?? 'N/A'}`,
    params.note?.trim() ? `Note: ${params.note.trim()}` : '',
    (params.attachmentUrls?.length ?? 0) > 0 ? `Files:\n${params.attachmentUrls?.join('\n')}` : '',
  ].filter(Boolean).join('\n')

  await sendEmail({
    to: params.to,
    subject: `Invoice Shared — ${invoiceNumber}`,
    html: renderEmailBase(`Invoice ${invoiceNumber} has been shared with you.`, content),
    text,
  })
}

export async function sendSupplierBookingRequestEmail(params: {
  to: string
  supplierName: string
  customerName: string
  description?: string | null
}): Promise<void> {
  const descHtml = params.description?.trim()
    ? dataTable([['Goods', escapeHtml(params.description.trim())]])
    : ''

  const content = [
    heading('New shipment request'),
    para(`Hi ${escapeHtml(params.supplierName)},`),
    para(`A customer (<strong>${escapeHtml(params.customerName)}</strong>) has named you as their supplier for a new shipment through Global Express.`),
    descHtml,
    alertBox('Please ship the goods to our <strong>Korea warehouse</strong> at your earliest convenience. Our team will be in touch with further details.', 'info'),
  ].join('')

  const text = [
    `Hi ${params.supplierName},`,
    `${params.customerName} has named you as their supplier for a new shipment.`,
    params.description?.trim() ? `Goods: ${params.description.trim()}` : '',
    '',
    'Please ship the goods to our Korea warehouse at your earliest convenience.',
  ].filter(Boolean).join('\n')

  await sendEmail({
    to: params.to,
    subject: 'New Shipment Request — Global Express',
    html: renderEmailBase(`${params.customerName} has sent you a new shipment request.`, content),
    text,
  })
}

export async function sendNewOrderAlertEmail(params: {
  to: string
  shipmentType: string
  customerName: string
  shippingMark: string | null
  customerPhone: string | null
  description: string
  weight: string | null
  declaredValue: string | null
  recipientName: string
  recipientPhone: string
  orderId: string
}): Promise<void> {
  const {
    to, shipmentType, customerName, shippingMark, customerPhone,
    description, weight, declaredValue, recipientName, recipientPhone, orderId,
  } = params

  const typeLabels: Record<string, string> = {
    air: 'Air Freight', ocean: 'Ocean Freight', d2d: 'Door-to-Door (D2D)',
  }
  const typeLabel = typeLabels[shipmentType] ?? shipmentType.toUpperCase()

  const rows: [string, string][] = [
    ['Customer', escapeHtml(customerName)],
    ...(shippingMark ? [['Shipping mark', escapeHtml(shippingMark)] as [string, string]] : []),
    ...(customerPhone ? [['Customer phone', escapeHtml(customerPhone)] as [string, string]] : []),
    ['Shipment type', escapeHtml(typeLabel)],
    ['Goods', escapeHtml(description || 'Not specified')],
    ...(weight ? [['Weight / volume', escapeHtml(weight)] as [string, string]] : []),
    ...(declaredValue ? [['Declared value', `USD ${escapeHtml(declaredValue)}`] as [string, string]] : []),
    ['Recipient', `${escapeHtml(recipientName)} / ${escapeHtml(recipientPhone)}`],
    ['Status', 'Pre-order submitted — awaiting warehouse receipt'],
    ['Order ref', escapeHtml(orderId)],
  ]

  const content = [
    heading(`New ${typeLabel} order`),
    para('A new order has been submitted and is awaiting warehouse receipt.'),
    dataTable(rows),
  ].join('')

  const text = [
    `New ${typeLabel} order.`,
    `Customer: ${customerName}${shippingMark ? ` (${shippingMark})` : ''}`,
    customerPhone ? `Phone: ${customerPhone}` : '',
    `Goods: ${description}`,
    weight ? `Weight: ${weight}` : '',
    declaredValue ? `Declared value: USD ${declaredValue}` : '',
    `Recipient: ${recipientName} / ${recipientPhone}`,
    'Status: Pre-order submitted',
    `Order ref: ${orderId}`,
  ].filter(Boolean).join('\n')

  await sendEmail({
    to,
    subject: `[Global Express] New ${typeLabel} — ${customerName}${shippingMark ? ` (${shippingMark})` : ''}`,
    html: renderEmailBase(`New ${typeLabel} order from ${customerName}.`, content),
    text,
  })
}
