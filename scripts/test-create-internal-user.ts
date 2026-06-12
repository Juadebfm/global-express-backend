import { config } from 'dotenv'
config({ path: '.env' })
import { internalAuthService } from '../src/services/internal-auth.service'
import { UserRole } from '../src/types/enums'
import { db } from '../src/config/db'
import { users } from '../drizzle/schema'
import { eq } from 'drizzle-orm'
import { hashEmail } from '../src/utils/encryption'

async function main() {
  const email = 'test-internal-user-debug@globalexpress.test'
  console.log('Testing createInternalUser...')

  try {
    const result = await internalAuthService.createInternalUser({
      email,
      role: UserRole.SUPER_ADMIN,
      firstName: 'Test',
      lastName: 'User',
    })
    console.log('SUCCESS:', JSON.stringify({ ...result, tempPassword: '[REDACTED]' }, null, 2))

    // Clean up
    const hash = hashEmail(email)
    await db.delete(users).where(eq(users.emailHash, hash))
    console.log('Cleaned up test user')
  } catch (err) {
    console.error('FAILED:', err)
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
