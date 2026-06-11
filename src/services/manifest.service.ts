import PDFDocument from 'pdfkit'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../config/db'
import { dispatchBatches, orders, orderPackages, users, payments } from '../../drizzle/schema'
import { decrypt } from '../utils/encryption'
import { PaymentStatus } from '../types/enums'

function fmt(v: string | null | undefined, decimals = 2): string {
  const n = parseFloat(v ?? '0')
  return isNaN(n) ? '—' : n.toFixed(decimals)
}

function decryptName(row: {
  firstName: string | null
  lastName: string | null
  businessName: string | null
}): string {
  const first = row.firstName ? decrypt(row.firstName) : null
  const last = row.lastName ? decrypt(row.lastName) : null
  const biz = row.businessName ? decrypt(row.businessName) : null
  return (first && last && `${first} ${last}`) || first || biz || '—'
}

export async function generateBatchManifestPdf(batchId: string): Promise<Buffer | null> {
  const [batch] = await db
    .select()
    .from(dispatchBatches)
    .where(and(eq(dispatchBatches.id, batchId), isNull(dispatchBatches.deletedAt)))
    .limit(1)

  if (!batch) return null

  const shipmentRows = await db
    .select({
      orderId: orders.id,
      trackingNumber: orders.trackingNumber,
      firstName: users.firstName,
      lastName: users.lastName,
      businessName: users.businessName,
      weight: orders.weight,
      finalChargeUsd: orders.finalChargeUsd,
      packageCount: orders.packageCount,
      statusV2: orders.statusV2,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.senderId))
    .where(and(eq(orders.dispatchBatchId, batchId), isNull(orders.deletedAt)))
    .orderBy(desc(orders.createdAt))

  if (shipmentRows.length === 0) return null

  const orderIds = shipmentRows.map((r) => r.orderId)

  // Per-order package aggregates
  const pkgAgg = await db
    .select({
      orderId: orderPackages.orderId,
      totalCbm: sql<string>`coalesce(sum(${orderPackages.cbm}), 0)::text`,
      itemTypes: sql<string>`string_agg(distinct ${orderPackages.itemType}, ', ')`,
      totalDeclaredUsd: sql<string>`coalesce(sum(${orderPackages.itemCostUsd}), 0)::text`,
    })
    .from(orderPackages)
    .where(inArray(orderPackages.orderId, orderIds))
    .groupBy(orderPackages.orderId)

  const pkgMap = new Map(pkgAgg.map((r) => [r.orderId, r]))

  // Per-order total paid
  const paidAgg = await db
    .select({
      orderId: payments.orderId,
      totalPaid: sql<string>`coalesce(sum(${payments.amount}), 0)::text`,
    })
    .from(payments)
    .where(and(inArray(payments.orderId, orderIds), eq(payments.status, PaymentStatus.SUCCESSFUL)))
    .groupBy(payments.orderId)

  const paidMap = new Map(paidAgg.map((r) => [r.orderId, r]))

  // ── Build PDF ──────────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const W = doc.page.width - 80  // usable width
    const GREY = '#666666'
    const DARK = '#111111'
    const BRAND = '#E85D04'
    const LINE = '#DDDDDD'

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(18).fillColor(BRAND).text('GLOBAL EXPRESS', 40, 40)
    doc.fontSize(10).fillColor(GREY).text('Dispatch Manifest', 40, 62)

    const generatedAt = new Date().toUTCString()
    doc.fontSize(8).fillColor(GREY).text(`Generated: ${generatedAt}`, 40, 76, { align: 'right', width: W })

    doc.moveTo(40, 92).lineTo(40 + W, 92).strokeColor(LINE).lineWidth(1).stroke()

    // ── Batch info ──────────────────────────────────────────────────────────
    doc.fontSize(9).fillColor(DARK)
    let y = 100
    const col2 = 40 + W / 2

    const batchMeta: [string, string][] = [
      ['Master Tracking', batch.masterTrackingNumber],
      ['Transport Mode', batch.transportMode.toUpperCase()],
      ['Status', batch.status.replace(/_/g, ' ').toUpperCase()],
      ['Carrier', batch.carrierName ?? '—'],
    ]
    const batchMeta2: [string, string][] = [
      ['Flight / Vessel No.', batch.voyageOrFlightNumber ?? '—'],
      ['Est. Departure', batch.estimatedDepartureAt ? new Date(batch.estimatedDepartureAt).toDateString() : '—'],
      ['Est. Arrival', batch.estimatedArrivalAt ? new Date(batch.estimatedArrivalAt).toDateString() : '—'],
      ['Total Shipments', String(shipmentRows.length)],
    ]

    batchMeta.forEach(([label, value], i) => {
      doc.fillColor(GREY).text(label, 40, y + i * 14)
      doc.fillColor(DARK).text(value, 160, y + i * 14)
    })
    batchMeta2.forEach(([label, value], i) => {
      doc.fillColor(GREY).text(label, col2, y + i * 14)
      doc.fillColor(DARK).text(value, col2 + 140, y + i * 14)
    })

    y += batchMeta.length * 14 + 16

    doc.moveTo(40, y).lineTo(40 + W, y).strokeColor(LINE).stroke()
    y += 12

    // ── Table header ────────────────────────────────────────────────────────
    const cols = {
      no:        { x: 40,        w: 28 },
      tracking:  { x: 68,        w: 110 },
      customer:  { x: 178,       w: 120 },
      weight:    { x: 298,       w: 55 },
      cbm:       { x: 353,       w: 50 },
      pkgs:      { x: 403,       w: 35 },
      items:     { x: 438,       w: 110 },
      declared:  { x: 548,       w: 65 },
      charge:    { x: 613,       w: 65 },
      paid:      { x: 678,       w: 62 },
    }

    doc.fontSize(7).fillColor(GREY)
    Object.entries(cols).forEach(([key, col]) => {
      const labels: Record<string, string> = {
        no: '#', tracking: 'TRACKING NO.', customer: 'CUSTOMER',
        weight: 'WEIGHT (kg)', cbm: 'CBM', pkgs: 'PKGS',
        items: 'ITEM TYPES', declared: 'DECLARED (USD)',
        charge: 'CHARGE (USD)', paid: 'PAID (USD)',
      }
      doc.text(labels[key] ?? key.toUpperCase(), col.x, y, { width: col.w })
    })

    y += 12
    doc.moveTo(40, y).lineTo(40 + W, y).strokeColor(LINE).stroke()
    y += 6

    // ── Table rows ──────────────────────────────────────────────────────────
    doc.fontSize(8)

    let totalWeight = 0
    let totalCbm = 0
    let totalCharge = 0
    let totalPaid = 0

    shipmentRows.forEach((row, idx) => {
      if (y > doc.page.height - 80) {
        doc.addPage()
        y = 40
      }

      const pkg = pkgMap.get(row.orderId)
      const paid = paidMap.get(row.orderId)

      const weightVal = parseFloat(row.weight ?? '0')
      const cbmVal = parseFloat(pkg?.totalCbm ?? '0')
      const chargeVal = parseFloat(row.finalChargeUsd ?? '0')
      const paidVal = parseFloat(paid?.totalPaid ?? '0')

      totalWeight += weightVal
      totalCbm += cbmVal
      totalCharge += chargeVal
      totalPaid += paidVal

      const customerName = decryptName({ firstName: row.firstName, lastName: row.lastName, businessName: row.businessName })

      doc.fillColor(idx % 2 === 0 ? '#FAFAFA' : '#FFFFFF')
         .rect(40, y - 2, W, 13).fill()

      doc.fillColor(DARK)
      doc.text(String(idx + 1),                     cols.no.x,       y, { width: cols.no.w })
      doc.text(row.trackingNumber,                   cols.tracking.x,  y, { width: cols.tracking.w })
      doc.text(customerName,                         cols.customer.x,  y, { width: cols.customer.w })
      doc.text(fmt(row.weight, 3),                   cols.weight.x,    y, { width: cols.weight.w })
      doc.text(fmt(pkg?.totalCbm, 4),                cols.cbm.x,       y, { width: cols.cbm.w })
      doc.text(String(row.packageCount ?? '—'),      cols.pkgs.x,      y, { width: cols.pkgs.w })
      doc.text(pkg?.itemTypes ?? '—',                cols.items.x,     y, { width: cols.items.w, ellipsis: true })
      doc.text(fmt(pkg?.totalDeclaredUsd),           cols.declared.x,  y, { width: cols.declared.w })
      doc.text(fmt(row.finalChargeUsd),              cols.charge.x,    y, { width: cols.charge.w })
      doc.text(fmt(paid?.totalPaid),                 cols.paid.x,      y, { width: cols.paid.w })

      y += 13
    })

    // ── Totals row ───────────────────────────────────────────────────────────
    y += 4
    doc.moveTo(40, y).lineTo(40 + W, y).strokeColor(LINE).stroke()
    y += 6

    doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold')
    doc.text('TOTALS', cols.no.x, y, { width: cols.customer.w + cols.no.w + cols.tracking.w })
    doc.text(totalWeight.toFixed(3),  cols.weight.x,   y, { width: cols.weight.w })
    doc.text(totalCbm.toFixed(4),     cols.cbm.x,      y, { width: cols.cbm.w })
    doc.text(totalCharge.toFixed(2),  cols.charge.x,   y, { width: cols.charge.w })
    doc.text(totalPaid.toFixed(2),    cols.paid.x,     y, { width: cols.paid.w })

    doc.end()
  })
}
