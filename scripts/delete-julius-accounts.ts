import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'
import { hashEmail } from '../src/utils/encryption'

const SOFT_DELETE = [
  'juadebgabriel@gmail.com',
  'juliusclauide@gmail.com',
]

const HARD_DELETE = [
  'cadnamart@gmail.com',
]

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

  for (const email of SOFT_DELETE) {
    const hash = hashEmail(email)
    const [user] = await db`SELECT id FROM users WHERE email_hash = ${hash} LIMIT 1`
    if (!user) { console.log(`NOT FOUND: ${email}`); continue }

    // email is NOT NULL — blank the hash so it can't be looked up; overwrite email with a dead placeholder
    const deadEmail = `deleted-${user.id}@purged`
    await db`
      UPDATE users
      SET email_hash = NULL, email = ${deadEmail}, deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${user.id}
    `
    console.log(`Soft-deleted + blanked: ${email} (${user.id})`)
  }

  for (const email of HARD_DELETE) {
    const hash = hashEmail(email)
    const [user] = await db`SELECT id FROM users WHERE email_hash = ${hash} LIMIT 1`
    if (!user) { console.log(`NOT FOUND: ${email}`); continue }

    await db`DELETE FROM users WHERE id = ${user.id}`
    console.log(`Hard-deleted: ${email} (${user.id})`)
  }

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
