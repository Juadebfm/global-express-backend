import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

  const orders = await db`
    SELECT o.tracking_number, o.status_v2, o.created_at, o.deleted_at,
           o.recipient_name, u.email_hash
    FROM orders o
    LEFT JOIN users u ON u.id = o.sender_id
    WHERE o.deleted_at IS NULL
    ORDER BY o.created_at DESC
  `
  console.log(`Total active orders: ${orders.length}`)
  for (const o of orders) {
    console.log(`  ${o.tracking_number}  status=${o.status_v2}  recipient="${o.recipient_name}"  created=${String(o.created_at).slice(0,10)}`)
  }

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
