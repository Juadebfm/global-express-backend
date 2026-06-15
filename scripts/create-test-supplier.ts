/**
 * Creates a test supplier account for development/testing.
 * Usage: npx tsx scripts/create-test-supplier.ts
 */
import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'
import { randomBytes, createHmac, createCipheriv } from 'crypto'
import * as bcrypt from 'bcryptjs'

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY
  if (keyHex?.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars')
  return Buffer.from(keyHex, 'hex')
}

function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex')
  ciphertext += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`
}

// Must match src/utils/hash.ts exactly — internal-auth.service uses that file for lookups.
// The key is passed as a raw string (not hex-decoded) to match how the DB hashes were created.
function hashEmail(email: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not set')
  return createHmac('sha256', key).update(email.toLowerCase().trim()).digest('hex')
}

async function main() {
  const email = 'test-supplier@globalexpress.dev'
  const password = 'TestSupplier123!'
  const firstName = 'Park'
  const lastName = 'Ji-yeon'
  const businessName = 'Seoul Beauty Exports Co.'
  const phone = '+821012345678'

  const emailHash = hashEmail(email)
  const passwordHash = await bcrypt.hash(password, 12)

  // Check if already exists
  const existing = await db`SELECT id FROM users WHERE email_hash = ${emailHash} AND deleted_at IS NULL LIMIT 1`
  if (existing.length) {
    console.log(`✓ Supplier already exists: ${existing[0].id}`)
    await db.end()
    return
  }

  const [user] = await db`
    INSERT INTO users (
      email, email_hash, password_hash,
      first_name, last_name, business_name, phone,
      role, is_active, must_complete_profile
    ) VALUES (
      ${encrypt(email)}, ${emailHash}, ${passwordHash},
      ${encrypt(firstName)}, ${encrypt(lastName)}, ${encrypt(businessName)}, ${encrypt(phone)},
      'supplier', true, false
    )
    RETURNING id
  `

  console.log('\n✓ Test supplier created')
  console.log(`  ID:           ${user.id}`)
  console.log(`  Email:        ${email}`)
  console.log(`  Password:     ${password}`)
  console.log(`  Business:     ${businessName}`)
  console.log(`  Role:         supplier`)
  await db.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
