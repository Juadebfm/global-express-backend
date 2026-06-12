import { config } from 'dotenv'
config({ path: '.env' })
import { db } from '../src/config/db'
import { users } from '../drizzle/schema'
import { eq } from 'drizzle-orm'
import { hashEmail } from '../src/utils/encryption'

async function main() {
  const hash = hashEmail('hazyom@gmail.com')
  const result = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive, createdAt: users.createdAt, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.emailHash, hash))
    .limit(1)
  console.log(result.length ? JSON.stringify(result[0], null, 2) : 'NOT FOUND')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
