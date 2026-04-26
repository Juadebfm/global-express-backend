/**
 * Cleanup script — removes temporary public gallery demo records.
 *
 * Usage:
 *   npm run seed:gallery:cleanup
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { sql } from 'drizzle-orm'
import { db } from '../src/config/db'
import { galleryItems } from '../drizzle/schema'

const SEED_SOURCE = 'scripts/seed-gallery.ts'

async function main() {
  console.log('\n🧹  Removing temporary public gallery seed rows...\n')

  const deleted = await db
    .delete(galleryItems)
    .where(sql`coalesce(${galleryItems.metadata} ->> 'seededBy', '') = ${SEED_SOURCE}`)
    .returning({ id: galleryItems.id })

  console.log(`  ✅  Removed rows: ${deleted.length}`)
  console.log('\nCleanup complete.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Cleanup failed:', err)
  process.exit(1)
})
