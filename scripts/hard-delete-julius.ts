import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'

// The two soft-deleted Julius user IDs
const USER_IDS = [
  'fab89415-add6-4e86-9685-ef27f3c66224', // juadebgabriel@gmail.com
  'cfa4c1b5-bc5a-4746-ad0a-a571b87d64d2', // juliusclauide@gmail.com
]

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

  // 1. Find all orders belonging to these users
  const orders = await db`
    SELECT id FROM orders WHERE sender_id = ANY(${USER_IDS}::uuid[])
  `
  const orderIds = orders.map((r: { id: string }) => r.id)
  console.log(`Found ${orderIds.length} orders to delete`)

  if (orderIds.length > 0) {
    // 2. Delete child records that don't cascade automatically
    const [n1] = await db`DELETE FROM payments WHERE order_id = ANY(${orderIds}::uuid[]) RETURNING id`
    console.log(`Deleted payments: ${Array.isArray(n1) ? n1.length : 'done'}`)

    const [n2] = await db`DELETE FROM notifications WHERE order_id = ANY(${orderIds}::uuid[]) RETURNING id`
    console.log(`Deleted notifications: ${Array.isArray(n2) ? n2.length : 'done'}`)

    // invoice_attachments cascade from invoices; delete invoices (which cascades attachments)
    await db`DELETE FROM invoice_attachments WHERE order_id = ANY(${orderIds}::uuid[])`
    const invoices = await db`SELECT id FROM invoices WHERE order_id = ANY(${orderIds}::uuid[])`
    const invoiceIds = invoices.map((r: { id: string }) => r.id)
    if (invoiceIds.length > 0) {
      await db`DELETE FROM invoice_attachments WHERE invoice_id = ANY(${invoiceIds}::uuid[])`
      await db`DELETE FROM invoices WHERE id = ANY(${invoiceIds}::uuid[])`
      console.log(`Deleted ${invoiceIds.length} invoices`)
    }

    // package_images before order_packages
    await db`DELETE FROM package_images WHERE order_id = ANY(${orderIds}::uuid[])`

    // These cascade: order_packages, order_status_events, shipment_measurements, invoice_attachments
    // Delete orders — cascades the rest
    await db`DELETE FROM orders WHERE id = ANY(${orderIds}::uuid[])`
    console.log(`Deleted ${orderIds.length} orders (cascade: packages, status events, measurements)`)
  }

  // 3. Hard-delete the user rows
  for (const userId of USER_IDS) {
    // Clean up any remaining user_suppliers links
    await db`DELETE FROM user_suppliers WHERE user_id = ${userId} OR supplier_id = ${userId}`
    // Null-out all nullable FK references across every table that points at users
    await db`UPDATE gallery_items SET assigned_user_id = NULL WHERE assigned_user_id = ${userId}`
    await db`UPDATE gallery_items SET assigned_supplier_id = NULL WHERE assigned_supplier_id = ${userId}`
    await db`UPDATE gallery_claims SET claimant_user_id = NULL WHERE claimant_user_id = ${userId}`
    await db`UPDATE gallery_claims SET reviewed_by = NULL WHERE reviewed_by = ${userId}`
    await db`UPDATE support_tickets SET assigned_to = NULL WHERE assigned_to = ${userId}`
    await db`UPDATE supplier_update_requests SET supplier_id = NULL WHERE supplier_id = ${userId}`
    await db`UPDATE supplier_update_requests SET requester_user_id = NULL WHERE requester_user_id = ${userId}`
    await db`UPDATE customer_pricing_overrides SET created_by = NULL WHERE created_by = ${userId}`
    await db`DELETE FROM user_suppliers WHERE user_id = ${userId} OR supplier_id = ${userId}`
    await db`DELETE FROM audit_logs WHERE user_id = ${userId}`
    await db`DELETE FROM notifications WHERE user_id = ${userId}`
    await db`DELETE FROM users WHERE id = ${userId}`
    console.log(`Hard-deleted user ${userId}`)
  }

  await db.end()
  console.log('Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
