import PDFDocument from 'pdfkit'
import type { GdprExportData } from './users.service'

const COLORS = {
  primary: '#1a1a2e',
  secondary: '#555555',
  accent: '#e86c00',
  border: '#cccccc',
  lightBg: '#f8f8f8',
}

function addSectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  if (doc.y > 700) doc.addPage()
  doc.moveDown(0.5).fontSize(14).fillColor(COLORS.primary).text(title)
  const underY = doc.y + 2
  doc
    .moveTo(50, underY)
    .lineTo(250, underY)
    .lineWidth(1)
    .strokeColor(COLORS.accent)
    .stroke()
  doc.moveDown(0.6)
}

function addKeyValueRow(doc: PDFKit.PDFDocument, label: string, value: string): void {
  if (doc.y > 740) doc.addPage()
  const startY = doc.y
  doc.fontSize(9).fillColor(COLORS.secondary).text(label, 50, startY, { width: 140 })
  doc.fontSize(9).fillColor(COLORS.primary).text(value || 'N/A', 195, startY, { width: 350 })
  doc.moveDown(0.3)
}

function formatAddress(profile: GdprExportData['profile']): string {
  const parts = [
    profile.addressStreet,
    profile.addressCity,
    profile.addressState,
    profile.addressCountry,
    profile.addressPostalCode,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'N/A'
}

export function generateGdprExportPdf(data: GdprExportData): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: false,
    info: {
      Title: 'Global Express — Account Data Export',
      Author: 'Global Express',
      Subject: 'GDPR Data Export',
      CreationDate: new Date(),
    },
  })

  // ── Header ──────────────────────────────────────────────────────────────────
  doc
    .fontSize(26)
    .fillColor(COLORS.accent)
    .text('GLOBAL EXPRESS', { align: 'center' })
  doc
    .fontSize(10)
    .fillColor(COLORS.secondary)
    .text('Logistics & Shipping Solutions', { align: 'center' })
  doc.moveDown(0.4)

  // Accent divider line
  const lineY = doc.y
  doc
    .moveTo(150, lineY)
    .lineTo(445, lineY)
    .lineWidth(1.5)
    .strokeColor(COLORS.accent)
    .stroke()
  doc.moveDown(0.6)

  doc
    .fontSize(18)
    .fillColor(COLORS.primary)
    .text('Account Data Export', { align: 'center' })
  doc.moveDown(0.3)
  doc
    .fontSize(10)
    .fillColor(COLORS.secondary)
    .text(`Generated on ${new Date().toISOString().slice(0, 10)}`, { align: 'center' })
  doc.moveDown(0.2)
  doc
    .fontSize(8)
    .fillColor(COLORS.secondary)
    .text(
      'This document contains all personal data held by Global Express per GDPR Article 15.',
      { align: 'center' },
    )
  doc.moveDown(0.4)

  // Bottom divider
  const lineY2 = doc.y
  doc
    .moveTo(50, lineY2)
    .lineTo(545, lineY2)
    .lineWidth(0.5)
    .strokeColor(COLORS.border)
    .stroke()
  doc.moveDown(1)

  // ── Profile Section ─────────────────────────────────────────────────────────
  addSectionHeading(doc, 'Profile Information')

  const { profile } = data
  const fullName =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'N/A'

  addKeyValueRow(doc, 'Name', fullName)
  addKeyValueRow(doc, 'Business Name', profile.businessName ?? 'N/A')
  addKeyValueRow(doc, 'Email', profile.email)
  addKeyValueRow(doc, 'Phone', profile.phone ?? 'N/A')
  addKeyValueRow(doc, 'WhatsApp', profile.whatsappNumber ?? 'N/A')
  addKeyValueRow(doc, 'Address', formatAddress(profile))
  addKeyValueRow(doc, 'Role', profile.role)
  addKeyValueRow(doc, 'Language', profile.preferredLanguage)
  addKeyValueRow(doc, 'Marketing Consent', profile.consentMarketing ? 'Yes' : 'No')
  addKeyValueRow(doc, 'Email Alerts', profile.notifyEmailAlerts ? 'Enabled' : 'Disabled')
  addKeyValueRow(doc, 'SMS/WhatsApp Alerts', profile.notifySmsAlerts ? 'Enabled' : 'Disabled')
  addKeyValueRow(doc, 'In-App Alerts', profile.notifyInAppAlerts ? 'Enabled' : 'Disabled')
  addKeyValueRow(doc, 'Account Created', profile.createdAt)

  // ── Orders Section ──────────────────────────────────────────────────────────
  doc.addPage()
  addSectionHeading(doc, `Orders (${data.orders.length})`)

  if (data.orders.length === 0) {
    doc.fontSize(10).fillColor(COLORS.secondary).text('No orders found.')
  } else {
    for (const order of data.orders) {
      if (doc.y > 680) doc.addPage()

      // Card border
      const cardY = doc.y
      doc
        .rect(50, cardY, 495, 70)
        .lineWidth(0.5)
        .strokeColor(COLORS.border)
        .stroke()

      doc.fontSize(10).fillColor(COLORS.primary).text(order.trackingNumber, 60, cardY + 8)
      doc
        .fontSize(8)
        .fillColor(COLORS.secondary)
        .text(`${order.origin} → ${order.destination}`, 60, cardY + 22)
      doc.text(
        `Status: ${(order.statusV2 ?? 'N/A').replace(/_/g, ' ')}  |  Type: ${order.shipmentType ?? 'N/A'}  |  Weight: ${order.weight ?? 'N/A'} kg`,
        60,
        cardY + 34,
      )
      doc.text(`Recipient: ${order.recipientName}  |  Phone: ${order.recipientPhone}`, 60, cardY + 46)
      doc
        .fontSize(7)
        .fillColor(COLORS.accent)
        .text(order.createdAt.slice(0, 10), 440, cardY + 8)

      doc.y = cardY + 78
    }
  }

  // ── Payments Section ────────────────────────────────────────────────────────
  doc.addPage()
  addSectionHeading(doc, `Payments (${data.payments.length})`)

  if (data.payments.length === 0) {
    doc.fontSize(10).fillColor(COLORS.secondary).text('No payments found.')
  } else {
    for (const payment of data.payments) {
      if (doc.y > 700) doc.addPage()

      const cardY = doc.y
      doc
        .rect(50, cardY, 495, 50)
        .lineWidth(0.5)
        .strokeColor(COLORS.border)
        .stroke()

      doc
        .fontSize(10)
        .fillColor(COLORS.primary)
        .text(`${payment.currency} ${payment.amount}`, 60, cardY + 8)
      doc
        .fontSize(8)
        .fillColor(COLORS.secondary)
        .text(
          `Status: ${payment.status}  |  Type: ${payment.paymentType}  |  Ref: ${payment.paystackReference ?? 'offline'}`,
          60,
          cardY + 22,
        )
      doc.text(`Paid: ${payment.paidAt?.slice(0, 10) ?? 'N/A'}`, 60, cardY + 34)
      doc
        .fontSize(7)
        .fillColor(COLORS.accent)
        .text(payment.createdAt.slice(0, 10), 440, cardY + 8)

      doc.y = cardY + 58
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  doc.moveDown(2)
  const footerLineY = doc.y
  doc
    .moveTo(50, footerLineY)
    .lineTo(545, footerLineY)
    .lineWidth(0.5)
    .strokeColor(COLORS.border)
    .stroke()
  doc.moveDown(0.5)
  doc
    .fontSize(8)
    .fillColor(COLORS.secondary)
    .text('Global Express — Confidential', { align: 'center' })
  doc
    .fontSize(7)
    .fillColor(COLORS.secondary)
    .text('This document was generated automatically. For questions, contact support@globalexpress.com.', { align: 'center' })

  doc.end()
  return doc
}
