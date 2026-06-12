import { config } from 'dotenv'
config({ path: '.env' })
import postgres from 'postgres'

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

async function main() {
  const rows = await db`
    SELECT id, email_hash, role, is_active, created_at, deleted_at, updated_at
    FROM users
    WHERE role = 'superadmin'
    ORDER BY created_at ASC
  `
  console.log(`Found ${rows.length} superadmin rows:\n`)
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2))
  }
  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
