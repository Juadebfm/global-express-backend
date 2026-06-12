import { config } from 'dotenv'
config({ path: '.env' })
import postgres from 'postgres'
import { decrypt } from '../src/utils/encryption'

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

async function main() {
  const rows = await db`
    SELECT id, email, first_name, last_name, role, is_active, created_at, deleted_at
    FROM users
    WHERE role IN ('superadmin', 'staff') AND deleted_at IS NULL
    ORDER BY created_at ASC
  `
  console.log(`Active internal users (${rows.length}):\n`)
  for (const r of rows) {
    let email = '[decrypt failed]'
    let name = '[decrypt failed]'
    try { email = decrypt(r.email) } catch {}
    try {
      const fn = r.first_name ? decrypt(r.first_name) : ''
      const ln = r.last_name  ? decrypt(r.last_name)  : ''
      name = `${fn} ${ln}`.trim()
    } catch {}
    console.log(`  ${r.id}  ${r.role.padEnd(12)}  ${name.padEnd(25)}  ${email}  created: ${r.created_at}`)
  }
  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
