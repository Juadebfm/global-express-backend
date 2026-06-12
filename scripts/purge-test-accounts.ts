import { config } from 'dotenv'
config({ path: '.env' })
import postgres from 'postgres'

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

async function main() {
  const targetId = 'a9ee1350-e389-4741-8db8-cccb06f51944'

  try {
    const r = await db`DELETE FROM users WHERE id = ${targetId} RETURNING id, role`
    if (r.length) console.log('✓ Hard-deleted:', r[0].id)
    else console.log('Not found.')
  } catch (err: any) {
    if (err.code === '23503') {
      console.log(`FK ref blocking delete: ${err.detail}`)
      console.log('Blanking email slot and soft-deleting instead...')
      await db`
        UPDATE users
        SET email_hash = ${'__purged__' + targetId},
            email      = ${'__purged__' + targetId},
            deleted_at = NOW(),
            updated_at = NOW()
        WHERE id = ${targetId}
      `
      console.log('Done — account removed from all active lists.')
    } else {
      throw err
    }
  }

  const remaining = await db`
    SELECT id, role, is_active, deleted_at, email_hash
    FROM users WHERE role IN ('superadmin','staff') ORDER BY created_at
  `
  console.log(`\nRemaining internal users (${remaining.length}):`)
  for (const r of remaining) {
    const status = r.deleted_at ? '🗑 soft-deleted' : r.is_active ? '✅ active' : '⏳ pending'
    console.log(`  ${status}  ${r.id}  ${String(r.email_hash).slice(0, 28)}...`)
  }
  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
