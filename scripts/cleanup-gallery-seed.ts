/**
 * Cleanup script — removes temporary public gallery demo records.
 *
 * Usage:
 *   npm run seed:gallery:cleanup
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { like } from 'drizzle-orm'
import { db } from '../src/config/db'
import { galleryItems } from '../drizzle/schema'

const TRACKING_PREFIX = 'SEED-GALLERY-V1-'

async function main() {
  console.log('\n🧹  Removing temporary public gallery seed rows...\n')

  const deleted = await db
    .delete(galleryItems)
    .where(like(galleryItems.trackingNumber, `${TRACKING_PREFIX}%`))
    .returning({ id: galleryItems.id })

  console.log(`  ✅  Removed rows: ${deleted.length}`)
  console.log('\nCleanup complete.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Cleanup failed:', err)
  process.exit(1)
})
