import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'

const TRACKING_NUMBERS = [
  'GEX-20260422-1E05BF68',
  'GEX-20260308-B6F21DEB',
]

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

  const orders = await db`
    SELECT id, tracking_number, sender_id FROM orders
    WHERE tracking_number = ANY(${TRACKING_NUMBERS}::text[])
  `
  console.log(`Found ${orders.length} orders:`, orders.map((o: { tracking_number: string; id: string }) => `${o.tracking_number} (${o.id})`))

  if (orders.length === 0) { await db.end(); return }

  const orderIds = orders.map((o: { id: string }) => o.id)

  // Delete child records that don't auto-cascade
  await db`DELETE FROM payments WHERE order_id = ANY(${orderIds}::uuid[])`
  await db`DELETE FROM notifications WHERE order_id = ANY(${orderIds}::uuid[])`
  await db`DELETE FROM package_images WHERE order_id = ANY(${orderIds}::uuid[])`

  // Get invoices first (invoice_attachments reference both invoice_id and order_id)
  const invoices = await db`SELECT id FROM invoices WHERE order_id = ANY(${orderIds}::uuid[])`
  const invoiceIds = invoices.map((r: { id: string }) => r.id)
  if (invoiceIds.length > 0) {
    await db`DELETE FROM invoice_attachments WHERE invoice_id = ANY(${invoiceIds}::uuid[])`
    await db`DELETE FROM invoices WHERE id = ANY(${invoiceIds}::uuid[])`
    console.log(`Deleted ${invoiceIds.length} invoices`)
  }

  // Delete orders — cascades: order_packages, order_status_events, shipment_measurements, invoice_attachments
  await db`DELETE FROM orders WHERE id = ANY(${orderIds}::uuid[])`
  console.log(`Deleted ${orderIds.length} orders`)

  await db.end()
  console.log('Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
