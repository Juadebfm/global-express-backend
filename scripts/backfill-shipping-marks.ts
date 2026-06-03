/**
 * One-shot backfill: assign auto-generated shipping marks to every existing
 * customer that doesn't have one yet.
 *
 *   npx tsx scripts/backfill-shipping-marks.ts            # dry run (default)
 *   npx tsx scripts/backfill-shipping-marks.ts --apply    # actually write
 *
 * Safe to re-run — only touches rows where shipping_mark IS NULL. The
 * `shipping_mark_user_edited_at` column is left NULL so the backfilled
 * customer can still use their one-time edit.
 *
 * Dedup: if two customers would get the same mark, the second/third/... get
 * a numeric suffix (`julade`, `julade2`, `julade3`...). We also check against
 * marks already in use by other customers (decrypted on the fly — fine for a
 * one-shot backfill, not for hot-path use).
 *
 * Skips staff/superadmin — they don't ship anything.
 */
import { config } from 'dotenv'
import { and, eq, isNull, or } from 'drizzle-orm'
import { db } from '../src/config/db'
import { users } from '../drizzle/schema'
import { encrypt, decrypt } from '../src/utils/encryption'
import {
  generateShippingMark,
  isValidShippingMark,
} from '../src/utils/shipping-mark'
import { UserRole } from '../src/types/enums'

config({ path: '.env' })

const APPLY = process.argv.includes('--apply')

async function loadExistingMarks(): Promise<Set<string>> {
  const rows = await db
    .select({ shippingMark: users.shippingMark })
    .from(users)
    .where(and(isNull(users.deletedAt)))

  const set = new Set<string>()
  for (const row of rows) {
    if (!row.shippingMark) continue
    try {
      set.add(decrypt(row.shippingMark).toLowerCase())
    } catch {
      // ignore — bad ciphertext shouldn't block the backfill
    }
  }
  return set
}

function pickUniqueMark(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate) && isValidShippingMark(candidate)) {
      return candidate
    }
  }
  throw new Error(`Could not find a unique mark for base "${base}" within 1000 attempts`)
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      businessName: users.businessName,
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        isNull(users.shippingMark),
        or(eq(users.role, UserRole.USER), eq(users.role, UserRole.SUPPLIER)),
      ),
    )

  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No customers need backfilling. Exiting.')
    return
  }

  const taken = await loadExistingMarks()

  // eslint-disable-next-line no-console
  console.log(
    `Found ${rows.length} customer(s) without a shipping mark; ${taken.size} mark(s) already in use.${
      APPLY ? ' Applying…' : ' (dry run — pass --apply to write)'
    }`,
  )

  let touched = 0
  for (const row of rows) {
    const base = generateShippingMark({
      firstName: row.firstName ? decrypt(row.firstName) : null,
      lastName: row.lastName ? decrypt(row.lastName) : null,
      businessName: row.businessName ? decrypt(row.businessName) : null,
    })
    const mark = pickUniqueMark(base, taken)
    taken.add(mark)

    if (APPLY) {
      await db
        .update(users)
        .set({ shippingMark: encrypt(mark), updatedAt: new Date() })
        .where(eq(users.id, row.id))
    }
    touched += 1

    // eslint-disable-next-line no-console
    console.log(`  ${row.id} → ${mark}${APPLY ? '' : ' (dry run)'}`)
  }

  // eslint-disable-next-line no-console
  console.log(`\n${APPLY ? 'Backfilled' : 'Would backfill'} ${touched} customer(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Backfill failed:', err)
    process.exit(1)
  })
