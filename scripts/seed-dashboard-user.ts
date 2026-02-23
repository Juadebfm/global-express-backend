/**
 * Seed script — creates / finds juadebgabriel2025@gmail.com and inserts
 * realistic dashboard test data: 25 orders over the past 30 days using
 * Asian ↔ African routes, all 4 new fields (shipmentType, priority,
 * departureDate, eta), and payments for delivered orders.
 *
 * Safe to re-run: deletes any previous orders created by this script
 * (identified by description containing "[seed-gabriel]") then re-inserts.
 *
 * Usage:
 *   npm run seed:gabriel
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { users, orders, payments } from '../drizzle/schema'
import { encrypt } from '../src/utils/encryption'
import { hashEmail } from '../src/utils/hash'
import { generateTrackingNumber } from '../src/utils/tracking'
import { UserRole, OrderStatus, OrderDirection, ShipmentType, Priority, PaymentStatus } from '../src/types/enums'
import { eq, isNull, and, like } from 'drizzle-orm'

const TARGET_EMAIL = 'juadebgabriel2025@gmail.com'
const SEED_CLERK_ID = 'seed_dashboard_gabriel'
const SEED_TAG = '[seed-gabriel]'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a Date that is `daysAgo` days before now, with optional hour offset */
function daysAgo(days: number, hourOffset = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(d.getHours() + hourOffset)
  return d
}

/** Returns a Date that is `daysFromNow` days in the future */
function daysFromNow(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

// ─── Asian ↔ African routes ───────────────────────────────────────────────────

const ROUTES: Array<{
  origin: string
  destination: string
  direction: OrderDirection
  shipmentType: ShipmentType
}> = [
  { origin: 'Shanghai, China',    destination: 'Lagos, Nigeria',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.OCEAN },
  { origin: 'Mumbai, India',      destination: 'Accra, Ghana',     direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR },
  { origin: 'Singapore',          destination: 'Nairobi, Kenya',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR },
  { origin: 'Tokyo, Japan',       destination: 'Cairo, Egypt',     direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.OCEAN },
  { origin: 'Dubai, UAE',         destination: 'Lagos, Nigeria',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR },
  { origin: 'Shenzhen, China',    destination: 'Abuja, Nigeria',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.OCEAN },
  { origin: 'Seoul, South Korea', destination: 'Accra, Ghana',     direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR },
  { origin: 'Lagos, Nigeria',     destination: 'Shanghai, China',  direction: OrderDirection.INBOUND,  shipmentType: ShipmentType.OCEAN },
  { origin: 'Nairobi, Kenya',     destination: 'Mumbai, India',    direction: OrderDirection.INBOUND,  shipmentType: ShipmentType.AIR },
  { origin: 'Dubai, UAE',         destination: 'Nairobi, Kenya',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.ROAD },
]

// ─── Order templates ──────────────────────────────────────────────────────────
// 25 orders: pending×4, picked_up×3, in_transit×8, out_for_delivery×3,
//            delivered×5, cancelled×1, returned×1

type OrderTemplate = {
  routeIdx: number
  status: OrderStatus
  priority: Priority
  weight: string
  declaredValue: string
  createdDaysAgo: number     // how far in the past the order was created
  departureDaysAgo?: number  // null = not yet departed
  etaDaysFromNow?: number    // positive = on time, negative = delayed (past)
  amount?: string            // set for delivered orders
}

const TEMPLATES: OrderTemplate[] = [
  // ── pending (4) ──
  { routeIdx: 0, status: OrderStatus.PENDING,          priority: Priority.STANDARD, weight: '12.50', declaredValue: '45000', createdDaysAgo: 2 },
  { routeIdx: 1, status: OrderStatus.PENDING,          priority: Priority.EXPRESS,  weight: '3.20',  declaredValue: '28000', createdDaysAgo: 1 },
  { routeIdx: 2, status: OrderStatus.PENDING,          priority: Priority.ECONOMY,  weight: '7.80',  declaredValue: '15000', createdDaysAgo: 3 },
  { routeIdx: 5, status: OrderStatus.PENDING,          priority: Priority.STANDARD, weight: '5.50',  declaredValue: '32000', createdDaysAgo: 1 },

  // ── picked_up (3) ──
  { routeIdx: 3, status: OrderStatus.PICKED_UP,        priority: Priority.EXPRESS,  weight: '18.00', declaredValue: '85000', createdDaysAgo: 5,  departureDaysAgo: 2 },
  { routeIdx: 4, status: OrderStatus.PICKED_UP,        priority: Priority.STANDARD, weight: '4.50',  declaredValue: '21000', createdDaysAgo: 4,  departureDaysAgo: 1 },
  { routeIdx: 6, status: OrderStatus.PICKED_UP,        priority: Priority.ECONOMY,  weight: '9.00',  declaredValue: '38000', createdDaysAgo: 6,  departureDaysAgo: 3 },

  // ── in_transit (8) ──
  { routeIdx: 0, status: OrderStatus.IN_TRANSIT,       priority: Priority.STANDARD, weight: '22.50', declaredValue: '95000', createdDaysAgo: 12, departureDaysAgo: 9,  etaDaysFromNow: 8  },
  { routeIdx: 1, status: OrderStatus.IN_TRANSIT,       priority: Priority.EXPRESS,  weight: '6.30',  declaredValue: '42000', createdDaysAgo: 10, departureDaysAgo: 7,  etaDaysFromNow: 3  },
  { routeIdx: 2, status: OrderStatus.IN_TRANSIT,       priority: Priority.ECONOMY,  weight: '15.00', declaredValue: '55000', createdDaysAgo: 15, departureDaysAgo: 12, etaDaysFromNow: 10 },
  { routeIdx: 3, status: OrderStatus.IN_TRANSIT,       priority: Priority.STANDARD, weight: '8.70',  declaredValue: '31000', createdDaysAgo: 8,  departureDaysAgo: 5,  etaDaysFromNow: 5  },
  { routeIdx: 4, status: OrderStatus.IN_TRANSIT,       priority: Priority.EXPRESS,  weight: '30.00', declaredValue: '120000',createdDaysAgo: 20, departureDaysAgo: 17, etaDaysFromNow: 6  },
  { routeIdx: 5, status: OrderStatus.IN_TRANSIT,       priority: Priority.STANDARD, weight: '11.20', declaredValue: '48000', createdDaysAgo: 9,  departureDaysAgo: 6,  etaDaysFromNow: 4  },
  // delayed — ETA already passed
  { routeIdx: 6, status: OrderStatus.IN_TRANSIT,       priority: Priority.ECONOMY,  weight: '5.80',  declaredValue: '19000', createdDaysAgo: 18, departureDaysAgo: 15, etaDaysFromNow: -2 },
  { routeIdx: 7, status: OrderStatus.IN_TRANSIT,       priority: Priority.EXPRESS,  weight: '14.00', declaredValue: '72000', createdDaysAgo: 22, departureDaysAgo: 19, etaDaysFromNow: -1 },

  // ── out_for_delivery (3) ──
  { routeIdx: 0, status: OrderStatus.OUT_FOR_DELIVERY, priority: Priority.EXPRESS,  weight: '3.50',  declaredValue: '25000', createdDaysAgo: 14, departureDaysAgo: 11, etaDaysFromNow: 1  },
  { routeIdx: 1, status: OrderStatus.OUT_FOR_DELIVERY, priority: Priority.STANDARD, weight: '7.20',  declaredValue: '33000', createdDaysAgo: 16, departureDaysAgo: 13, etaDaysFromNow: 0  },
  { routeIdx: 9, status: OrderStatus.OUT_FOR_DELIVERY, priority: Priority.ECONOMY,  weight: '20.00', declaredValue: '68000', createdDaysAgo: 18, departureDaysAgo: 15, etaDaysFromNow: 1  },

  // ── delivered (5) ── — get payments
  { routeIdx: 2, status: OrderStatus.DELIVERED,        priority: Priority.STANDARD, weight: '4.80',  declaredValue: '18000', createdDaysAgo: 28, departureDaysAgo: 25, etaDaysFromNow: -20, amount: '52000' },
  { routeIdx: 3, status: OrderStatus.DELIVERED,        priority: Priority.EXPRESS,  weight: '9.50',  declaredValue: '67000', createdDaysAgo: 25, departureDaysAgo: 22, etaDaysFromNow: -17, amount: '78000' },
  { routeIdx: 4, status: OrderStatus.DELIVERED,        priority: Priority.ECONOMY,  weight: '16.00', declaredValue: '43000', createdDaysAgo: 29, departureDaysAgo: 26, etaDaysFromNow: -21, amount: '61000' },
  { routeIdx: 0, status: OrderStatus.DELIVERED,        priority: Priority.STANDARD, weight: '6.20',  declaredValue: '29000', createdDaysAgo: 20, departureDaysAgo: 17, etaDaysFromNow: -12, amount: '45000' },
  { routeIdx: 8, status: OrderStatus.DELIVERED,        priority: Priority.EXPRESS,  weight: '2.80',  declaredValue: '12000', createdDaysAgo: 22, departureDaysAgo: 19, etaDaysFromNow: -15, amount: '38000' },

  // ── cancelled (1) ──
  { routeIdx: 5, status: OrderStatus.CANCELLED,        priority: Priority.STANDARD, weight: '10.00', declaredValue: '37000', createdDaysAgo: 10 },

  // ── returned (1) ──
  { routeIdx: 6, status: OrderStatus.RETURNED,         priority: Priority.ECONOMY,  weight: '8.00',  declaredValue: '26000', createdDaysAgo: 25, departureDaysAgo: 22, etaDaysFromNow: -15 },
]

const RECIPIENTS = [
  { name: 'Adewale Okafor',   address: '14 Adeola Odeku St, Victoria Island', phone: '+2348012345678', email: 'adewale@testmail.com' },
  { name: 'Fatou Diallo',     address: '28 Independence Ave, Accra',           phone: '+233501234567',  email: null },
  { name: 'Amina Wanjiku',    address: '5 Ngong Road, Westlands, Nairobi',     phone: '+254712345678',  email: 'amina@testmail.com' },
  { name: 'Omar Hassan',      address: '12 El Tahrir Square, Cairo',           phone: '+201234567890',  email: null },
  { name: 'Chidinma Eze',     address: '9 Maitama District, Abuja',            phone: '+2348056789012', email: 'chidinma@testmail.com' },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌱  Seeding dashboard data for ${TARGET_EMAIL}...\n`)

  // ── 1. Find or create the user ─────────────────────────────────────────────
  const emailHash = hashEmail(TARGET_EMAIL)

  let [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailHash, emailHash))
    .limit(1)

  if (!user) {
    // Try by clerkId (if previously seeded with fake clerkId)
    const [byClerk] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, SEED_CLERK_ID))
      .limit(1)

    if (byClerk) {
      user = byClerk
    } else {
      // Create the user with a fake clerkId (mirrors Clerk auto-provision flow)
      const [created] = await db
        .insert(users)
        .values({
          clerkId: SEED_CLERK_ID,
          email: encrypt(TARGET_EMAIL),
          firstName: encrypt('Ju'),
          lastName: encrypt('Gabriel'),
          phone: encrypt('+2348099887766'),
          whatsappNumber: encrypt('+2348099887766'),
          addressStreet: encrypt('22 Adeola Odeku Street'),
          addressCity: 'Lagos',
          addressState: 'Lagos',
          addressCountry: 'Nigeria',
          addressPostalCode: '101233',
          role: UserRole.USER,
          isActive: true,
          consentMarketing: true,
        })
        .returning({ id: users.id })

      user = created
      console.log(`  ✅  Created user: ${TARGET_EMAIL} (id: ${user.id})`)
    }
  } else {
    console.log(`  ✅  Found existing user: ${TARGET_EMAIL} (id: ${user.id})`)
  }

  const userId = user.id

  // ── 2. Find the superadmin for createdBy ──────────────────────────────────
  const [superadmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, UserRole.SUPERADMIN), isNull(users.deletedAt)))
    .limit(1)

  if (!superadmin) {
    console.error('\n❌  No superadmin found. Run "npm run seed:superadmin" first.\n')
    process.exit(1)
  }

  // ── 3. Remove previous seed orders for this user ──────────────────────────
  const existingOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.senderId, userId), like(orders.description, `%${SEED_TAG}%`)))

  if (existingOrders.length > 0) {
    const ids = existingOrders.map((o) => o.id)
    // Delete payments first (FK constraint)
    for (const id of ids) {
      await db.delete(payments).where(eq(payments.orderId, id))
    }
    for (const id of ids) {
      await db.delete(orders).where(eq(orders.id, id))
    }
    console.log(`  🧹  Removed ${ids.length} previous seed orders`)
  }

  // ── 4. Insert orders ───────────────────────────────────────────────────────
  const ordersWithPayment: Array<{ orderId: string; amount: string }> = []

  for (let i = 0; i < TEMPLATES.length; i++) {
    const tmpl = TEMPLATES[i]
    const route = ROUTES[tmpl.routeIdx % ROUTES.length]
    const recipient = RECIPIENTS[i % RECIPIENTS.length]

    const createdAt = daysAgo(tmpl.createdDaysAgo)
    const departureDate = tmpl.departureDaysAgo != null ? daysAgo(tmpl.departureDaysAgo) : null
    const eta = tmpl.etaDaysFromNow != null ? daysFromNow(tmpl.etaDaysFromNow) : null

    const [order] = await db
      .insert(orders)
      .values({
        trackingNumber: generateTrackingNumber(),
        senderId: userId,
        recipientName: encrypt(recipient.name),
        recipientAddress: encrypt(recipient.address),
        recipientPhone: encrypt(recipient.phone),
        recipientEmail: recipient.email ? encrypt(recipient.email) : null,
        origin: route.origin,
        destination: route.destination,
        status: tmpl.status,
        orderDirection: route.direction,
        weight: tmpl.weight,
        declaredValue: tmpl.declaredValue,
        description: `${route.origin} → ${route.destination} cargo ${SEED_TAG}`,
        shipmentType: route.shipmentType,
        priority: tmpl.priority,
        departureDate,
        eta,
        createdBy: superadmin.id,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: orders.id })

    if (tmpl.amount) {
      ordersWithPayment.push({ orderId: order.id, amount: tmpl.amount })
    }
  }

  console.log(`  ✅  Orders: ${TEMPLATES.length} created`)

  // ── 5. Insert payments for delivered orders ────────────────────────────────
  for (const { orderId, amount } of ordersWithPayment) {
    const ref = `GBR-${Math.random().toString(36).slice(2, 12).toUpperCase()}`
    await db.insert(payments).values({
      orderId,
      userId,
      amount,
      currency: 'NGN',
      paystackReference: ref,
      paystackTransactionId: `gabriel_txn_${ref.toLowerCase()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: new Date(),
    })
  }

  console.log(`  ✅  Payments: ${ordersWithPayment.length} successful payments`)

  // ── Summary ────────────────────────────────────────────────────────────────
  const statusSummary = TEMPLATES.reduce(
    (acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc },
    {} as Record<string, number>,
  )

  console.log('\n✅  Done!\n')
  console.log('    Orders by status:')
  for (const [status, count] of Object.entries(statusSummary)) {
    console.log(`      • ${status.padEnd(20)} ${count}`)
  }
  console.log(`\n    Test dashboard endpoints:`)
  console.log(`      GET /api/v1/dashboard/stats`)
  console.log(`      GET /api/v1/dashboard/trends?year=2026`)
  console.log(`      GET /api/v1/dashboard/active-deliveries\n`)

  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err)
  process.exit(1)
})
