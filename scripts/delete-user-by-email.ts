/**
 * Hard-delete a user by email from any DATABASE_URL.
 * Usage:
 *   DATABASE_URL=<url> npx tsx scripts/delete-user-by-email.ts hazyom@gmail.com
 */
import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'
import { hashEmail } from '../src/utils/hash'

const email = process.argv[2]
if (!email) {
  console.error('Usage: npx tsx scripts/delete-user-by-email.ts <email>')
  process.exit(1)
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

async function main() {
  const hash = hashEmail(email)
  console.log(`Looking up: ${email}`)
  console.log(`emailHash: ${hash}`)

  const db = postgres(DATABASE_URL!, { ssl: 'require', max: 1 })

  const found = await db`
    SELECT id, role, is_active, created_at, deleted_at
    FROM users WHERE email_hash = ${hash}
  `

  if (!found.length) {
    console.log('NOT FOUND — nothing to delete')
    await db.end()
    process.exit(0)
  }

  console.log('Found:', JSON.stringify(found[0], null, 2))

  const userId = found[0].id

  // The user has real FK references across orders/shipments/etc so a hard DELETE
  // would cascade badly. Instead: blank out email + emailHash on the soft-deleted
  // record so the unique constraint slot is freed and a fresh invite can be sent.
  const purgedEmail = `__purged__${userId}`
  const purgedHash  = `__purged__${userId}`

  await db`
    UPDATE users
    SET email = ${purgedEmail}, email_hash = ${purgedHash}, updated_at = now()
    WHERE id = ${userId}
  `

  console.log(`Email slot cleared — user ${userId} is still in DB (soft-deleted) but emailHash freed.`)
  console.log('You can now invite hazyom@gmail.com again.')
  await db.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
