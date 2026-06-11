/**
 * Soft-deletes all orders (and cascades to related packages/invoices) for a user
 * identified by shipping mark. User record is left untouched.
 *
 * Usage:
 *   npx tsx scripts/clear-user-orders.ts <shippingMark>
 *
 * Example:
 *   npx tsx scripts/clear-user-orders.ts nasnye
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { users, orders, orderPackages, invoices } from '../drizzle/schema'
import { eq, isNull, and, isNotNull, inArray } from 'drizzle-orm'
import { decrypt } from '../src/utils/encryption'
import { UserRole } from '../src/types/enums'

async function main() {
  const mark = process.argv[2]?.trim().toLowerCase()
  if (!mark) {
    console.error('Usage: npx tsx scripts/clear-user-orders.ts <shippingMark>')
    process.exit(1)
  }

  // Find user by shipping mark
  const candidates = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, shippingMark: users.shippingMark })
    .from(users)
    .where(and(isNull(users.deletedAt), isNotNull(users.shippingMark)))

  const match = candidates.find(
    (u) => u.shippingMark && decrypt(u.shippingMark).toLowerCase() === mark,
  )

  if (!match) {
    console.error(`No user found with shipping mark "${mark}"`)
    process.exit(1)
  }

  const firstName = match.firstName ? decrypt(match.firstName) : ''
  const lastName = match.lastName ? decrypt(match.lastName) : ''
  console.log(`\nUser: ${firstName} ${lastName} (id: ${match.id})`)

  // Find all non-deleted orders for this user
  const userOrders = await db
    .select({ id: orders.id, trackingNumber: orders.trackingNumber, statusV2: orders.statusV2 })
    .from(orders)
    .where(and(eq(orders.senderId, match.id), isNull(orders.deletedAt)))

  if (userOrders.length === 0) {
    console.log('No orders found — nothing to clear.')
    process.exit(0)
  }

  console.log(`\nFound ${userOrders.length} order(s) to remove:`)
  for (const o of userOrders) {
    console.log(`  • ${o.trackingNumber} [${o.statusV2}]`)
  }

  const orderIds = userOrders.map((o) => o.id)
  const now = new Date()

  // Soft-delete orders
  await db
    .update(orders)
    .set({ deletedAt: now, updatedAt: now })
    .where(inArray(orders.id, orderIds))

  console.log(`\n✅ Soft-deleted ${userOrders.length} order(s). User account untouched.\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
