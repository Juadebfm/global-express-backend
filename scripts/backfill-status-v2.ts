/**
 * Phase 6 Backfill Script — Migrate legacy `status` → `statusV2`
 *
 * Run ONCE against the live database after deploying Phase 6 code.
 *
 *   npm run backfill:status-v2
 *
 * What it does:
 *   1. Finds all `orders` with `status_v2 IS NULL AND deleted_at IS NULL`.
 *   2. For each, maps the legacy `status` → `statusV2` using the deterministic map.
 *      - If `status` is mode-dependent (`picked_up` / `in_transit`) and `transport_mode` is null,
 *        the order is flagged (`flagged_for_admin_review = true`) instead of mapped.
 *      - Orders with `final_charge_usd IS NULL` are tagged `pricing_source = MIGRATED_UNVERIFIED`.
 *   3. Prints a summary of all outcomes.
 *
 * After running, verify:
 *   SELECT count(*) FROM orders WHERE status_v2 IS NULL AND flagged_for_admin_review = false AND deleted_at IS NULL;
 *   -- Must be 0 before proceeding to column drop.
 *
 *   SELECT count(*) FROM orders WHERE flagged_for_admin_review = true;
 *   -- Review these manually and assign transport_mode, then re-run.
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../src/config/db'
import { orders } from '../drizzle/schema'
import { mapLegacyStatusToV2 } from '../src/domain/shipment-v2/status-mapping'
import { OrderStatus, PricingSource } from '../src/types/enums'

// These two legacy statuses require knowing the transport mode to map correctly.
const MODE_DEPENDENT = new Set<string>([OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT])

// ─── Solo orders ──────────────────────────────────────────────────────────────

async function backfillOrders(): Promise<{ mapped: number; flagged: number; errors: number; skipped: number }> {
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      transportMode: orders.transportMode,
      finalChargeUsd: orders.finalChargeUsd,
    })
    .from(orders)
    .where(and(isNull(orders.statusV2), isNull(orders.deletedAt)))

  let mapped = 0
  let flagged = 0
  let errors = 0
  const skipped = 0

  for (const row of rows) {
    try {
      const needsMode = MODE_DEPENDENT.has(row.status)
      if (needsMode && !row.transportMode) {
        // Cannot determine correct V2 status without knowing the transport mode.
        await db
          .update(orders)
          .set({ flaggedForAdminReview: true, updatedAt: new Date() })
          .where(eq(orders.id, row.id))
        flagged++
        continue
      }

      const v2Status = mapLegacyStatusToV2(row.status as OrderStatus, row.transportMode)
      if (!v2Status) {
        // mapLegacyStatusToV2 returned null — treat as flagged
        await db
          .update(orders)
          .set({ flaggedForAdminReview: true, updatedAt: new Date() })
          .where(eq(orders.id, row.id))
        flagged++
        continue
      }

      const noTrustedPrice = row.finalChargeUsd === null

      await db
        .update(orders)
        .set({
          statusV2: v2Status,
          customerStatusV2: v2Status,
          ...(noTrustedPrice ? { pricingSource: PricingSource.MIGRATED_UNVERIFIED } : {}),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, row.id))

      mapped++
    } catch (err) {
      console.error(`  ERROR on order ${row.id}:`, err)
      errors++
    }
  }

  return { mapped, flagged, errors, skipped }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Phase 6 Status V2 Backfill ===\n')

  console.log('Backfilling solo orders...')
  const orderResult = await backfillOrders()
  console.log(
    `  Orders: ${orderResult.mapped} mapped, ${orderResult.flagged} flagged for admin review, ${orderResult.errors} errors\n`,
  )

  const totalErrors = orderResult.errors
  const totalFlagged = orderResult.flagged

  console.log('=== Summary ===')
  console.log(`Total mapped:  ${orderResult.mapped}`)
  console.log(`Total flagged: ${totalFlagged}  ← assign transport_mode to these and re-run`)
  console.log(`Total errors:  ${totalErrors}`)

  if (totalFlagged > 0) {
    console.log('\nTo find flagged orders:')
    console.log("  SELECT id, status, transport_mode FROM orders WHERE flagged_for_admin_review = true;")
  }

  if (totalErrors > 0) {
    process.exit(1)
  }

  console.log('\nBackfill complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
