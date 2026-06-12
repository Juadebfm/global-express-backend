/**
 * 1. Hard-delete the brand-new hazyom@gmail.com account (no FK refs yet).
 * 2. Report on the other mystery superadmin records.
 */
import { config } from 'dotenv'
config({ path: '.env' })
import postgres from 'postgres'

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

async function main() {
  const hazyomId = '17b846de-15bb-4239-b4ea-0f295eb65311'

  // Check for any FK references before deleting
  // Attempt hard-delete; fall back to blanking email slot if FK refs exist
  try {
    await db`DELETE FROM users WHERE id = ${hazyomId}`
    console.log('✓ Hard-deleted hazyom@gmail.com account (17b846de)')
  } catch (err: any) {
    if (err.code === '23503') {
      console.log(`⚠️  FK ref: ${err.detail} — blanking email slot instead`)
      await db`UPDATE users SET email_hash = ${'__purged__' + hazyomId}, email = ${'__purged__' + hazyomId}, deleted_at = NOW(), updated_at = NOW() WHERE id = ${hazyomId}`
      console.log('Done — email slot cleared, record soft-deleted.')
    } else {
      throw err
    }
  }

  // Show remaining superadmins for awareness
  const remaining = await db`
    SELECT id, email_hash, is_active, created_at, deleted_at
    FROM users WHERE role = 'superadmin' ORDER BY created_at
  `
  console.log(`\nRemaining superadmin records (${remaining.length}):`)
  for (const r of remaining) {
    const status = r.deleted_at ? '🗑 soft-deleted' : r.is_active ? '✅ active' : '⏳ pending'
    console.log(`  ${status}  ${r.id}  hash: ${String(r.email_hash).slice(0, 20)}...  created: ${r.created_at}`)
  }

  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
