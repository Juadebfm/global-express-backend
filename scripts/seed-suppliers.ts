/**
 * Seed script — inserts 2 test supplier accounts with full profile data.
 *
 * Usage:
 *   npx tsx scripts/seed-suppliers.ts
 *
 * Safe to run multiple times — aborts if seed marker already exists.
 * To re-seed, delete rows WHERE clerk_id LIKE 'seed_supplier_v1_%' from users table.
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { users } from '../drizzle/schema'
import { encrypt } from '../src/utils/encryption'
import { hashEmail } from '../src/utils/hash'
import { UserRole } from '../src/types/enums'
import { eq } from 'drizzle-orm'

const SEED_MARKER = 'seed_supplier_v1'

const SUPPLIERS = [
  {
    seedTag: `${SEED_MARKER}_1`,
    email: 'sungjin.trading@suppliertest.com',
    firstName: 'Sung-Jin',
    lastName: 'Park',
    businessName: 'Sungjin Trading Co.',
    phone: '+821012345678',
    whatsappNumber: '+821012345678',
    addressStreet: '14 Gangnam-daero, Gangnam-gu',
    addressCity: 'Seoul',
    addressState: 'Seoul',
    addressCountry: 'South Korea',
    addressPostalCode: '06000',
  },
  {
    seedTag: `${SEED_MARKER}_2`,
    email: 'hanyang.logistics@suppliertest.com',
    firstName: 'Ji-Young',
    lastName: 'Kim',
    businessName: 'Hanyang Global Logistics Ltd.',
    phone: '+821098765432',
    whatsappNumber: '+821098765432',
    addressStreet: '7 Mapo-daero, Mapo-gu',
    addressCity: 'Seoul',
    addressState: 'Seoul',
    addressCountry: 'South Korea',
    addressPostalCode: '04107',
  },
]

async function main() {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, `${SEED_MARKER}_1`))
    .limit(1)

  if (existing) {
    console.log('\n⚠️  Supplier seed data already exists. Skipping.')
    console.log(`    To re-seed, delete rows WHERE clerk_id LIKE '${SEED_MARKER}_%' from users.\n`)
    process.exit(0)
  }

  console.log('\n🌱  Seeding supplier accounts...\n')

  for (const s of SUPPLIERS) {
    const [row] = await db
      .insert(users)
      .values({
        clerkId: s.seedTag,
        email: encrypt(s.email),
        emailHash: hashEmail(s.email),
        firstName: encrypt(s.firstName),
        lastName: encrypt(s.lastName),
        businessName: encrypt(s.businessName),
        phone: encrypt(s.phone),
        whatsappNumber: encrypt(s.whatsappNumber),
        addressStreet: encrypt(s.addressStreet),
        addressCity: s.addressCity,
        addressState: s.addressState,
        addressCountry: s.addressCountry,
        addressPostalCode: s.addressPostalCode,
        role: UserRole.SUPPLIER,
        isActive: true,
      })
      .returning({ id: users.id })

    console.log(`  ✅  Supplier: ${s.businessName} <${s.email}>  (id: ${row.id})`)
  }

  console.log('\n✅  Done! 2 supplier accounts created.\n')
  console.log('    Use GET /api/v1/users/suppliers to verify they appear in the supplier picker.\n')

  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err)
  process.exit(1)
})
