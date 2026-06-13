import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'
import { hashEmail } from '../src/utils/encryption'

const EMAILS = [
  'juadebgabriel@gmail.com',
  'juliusclauide@gmail.com',
  'cadnamart@gmail.com',
]

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

  for (const email of EMAILS) {
    const hash = hashEmail(email)
    const [user] = await db`SELECT id, role, is_active, deleted_at, created_at FROM users WHERE email_hash = ${hash} LIMIT 1`
    if (!user) { console.log(`NOT FOUND: ${email}`); continue }

    const [orders] = await db`SELECT count(*)::int as c FROM orders WHERE sender_id = ${user.id} AND deleted_at IS NULL`
    const [invoices] = await db`SELECT count(*)::int as c FROM invoices WHERE bill_to_user_id = ${user.id}`
    const [payments] = await db`SELECT count(*)::int as c FROM payments WHERE user_id = ${user.id}`

    console.log(`\n${email}`)
    console.log(`  id=${user.id} role=${user.role} active=${user.is_active} deleted=${user.deleted_at}`)
    console.log(`  orders=${orders.c} invoices=${invoices.c} payments=${payments.c}`)
  }

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
