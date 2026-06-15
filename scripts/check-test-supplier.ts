import { config } from 'dotenv'
config({ path: '.env' })
import postgres from 'postgres'
import { createHmac } from 'crypto'

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const hash = createHmac('sha256', key).update('test-supplier@globalexpress.dev').digest('hex')

  const rows = await db`
    SELECT id, role, is_active, must_change_password, must_complete_profile,
           deleted_at, failed_login_count, locked_until
    FROM users WHERE email_hash = ${hash}
  `
  console.log(JSON.stringify(rows[0], null, 2))
  await db.end()
}

main().catch(console.error)
