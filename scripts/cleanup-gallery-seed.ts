/**
 * Cleanup script — removes temporary public gallery demo records.
 *
 * Usage:
 *   npm run seed:gallery:cleanup
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { inArray, sql } from 'drizzle-orm'
import { db } from '../src/config/db'
import { galleryItems, inboundLeads, shopInterestRequests, shopListings } from '../drizzle/schema'

const SEED_SOURCE = 'scripts/seed-gallery.ts'

async function main() {
  console.log('\n🧹  Removing temporary public gallery seed rows...\n')

  const seededShopRows = await db
    .select({ id: shopListings.id })
    .from(shopListings)
    .where(sql`coalesce(${shopListings.metadata} ->> 'seededBy', '') = ${SEED_SOURCE}`)

  if (seededShopRows.length > 0) {
    const ids = seededShopRows.map((row) => row.id)
    await db
      .delete(shopInterestRequests)
      .where(inArray(shopInterestRequests.listingId, ids))
    await db
      .delete(shopListings)
      .where(inArray(shopListings.id, ids))
  }

  const deleted = await db
    .delete(galleryItems)
    .where(sql`coalesce(${galleryItems.metadata} ->> 'seededBy', '') = ${SEED_SOURCE}`)
    .returning({ id: galleryItems.id })

  if (deleted.length > 0) {
    const deletedGalleryIds = deleted.map((row) => row.id)
    await db.delete(inboundLeads).where(inArray(inboundLeads.itemId, deletedGalleryIds))
  }

  console.log(`  ✅  Removed rows: ${deleted.length}`)
  console.log('\nCleanup complete.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Cleanup failed:', err)
  process.exit(1)
})
