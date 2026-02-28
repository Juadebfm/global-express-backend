/**
 * One-time seed script — creates the first superadmin account.
 *
 * Usage:
 *   npm run seed:superadmin
 *
 * The email and password are read from environment variables:
 *   SUPERADMIN_EMAIL=admin@yourcompany.com
 *   SUPERADMIN_PASSWORD=yourSecurePassword123
 *
 * These can be in your .env file or passed inline:
 *   SUPERADMIN_EMAIL=admin@example.com SUPERADMIN_PASSWORD=secret npm run seed:superadmin
 *
 * The script is safe to run multiple times — it aborts if a superadmin already exists.
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { users } from '../drizzle/schema'
import { eq, isNull, and } from 'drizzle-orm'
import { internalAuthService } from '../src/services/internal-auth.service'
import { UserRole } from '../src/types/enums'

async function main() {
  const email = process.env.SUPERADMIN_EMAIL
  const password = process.env.SUPERADMIN_PASSWORD

  if (!email || !password) {
    console.error('\n❌  Missing required environment variables:')
    console.error('     SUPERADMIN_EMAIL  — the superadmin email address')
    console.error('     SUPERADMIN_PASSWORD — the superadmin password (min 8 chars)')
    console.error('\nExample:')
    console.error('  SUPERADMIN_EMAIL=admin@example.com SUPERADMIN_PASSWORD=secret123 npm run seed:superadmin\n')
    process.exit(1)
  }

  if (password.length < 8) {
    console.error('\n❌  SUPERADMIN_PASSWORD must be at least 8 characters.\n')
    process.exit(1)
  }

  // Abort if any superadmin already exists
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, UserRole.SUPERADMIN), isNull(users.deletedAt)))
    .limit(1)

  if (existing) {
    console.log('\n⚠️   A superadmin account already exists. Aborting to prevent duplicates.')
    console.log('     Use PATCH /api/v1/internal/users/:id/password to reset the password.\n')
    process.exit(0)
  }

  const user = await internalAuthService.createInternalUser({
    email,
    password,
    role: UserRole.SUPERADMIN,
    firstName: 'Super',
    lastName: 'Admin',
  })

  // Superadmin seeded via script should be active immediately (bypass approval flow)
  await db
    .update(users)
    .set({ isActive: true })
    .where(eq(users.id, user.id))

  console.log('\n✅  Superadmin created successfully!')
  console.log(`     ID:    ${user.id}`)
  console.log(`     Email: ${user.email}`)
  console.log(`     Role:  ${user.role}`)
  console.log('\n     Login via: POST /api/v1/internal/auth/login\n')

  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err)
  process.exit(1)
})
