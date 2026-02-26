/**
 * Seed script — creates / finds juadebgabriel@gmail.com and inserts
 * realistic dashboard test data: 25 orders over the past 30 days using
 * Asian ↔ African routes, all fields populated, payments for delivered orders.
 *
 * SAFE TO RE-RUN: only deletes orders where BOTH conditions are true:
 *   1. senderId = juadebgabriel@gmail.com's user id
 *   2. description contains "[seed-gabriel2]"
 * No other customer's data is ever touched.
 *
 * Usage:
 *   npm run seed:gabriel2
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { users, orders, payments } from '../drizzle/schema'
import { encrypt } from '../src/utils/encryption'
import { hashEmail } from '../src/utils/hash'
import { generateTrackingNumber } from '../src/utils/tracking'
import { UserRole, OrderDirection, ShipmentType, Priority, PaymentStatus, ShipmentStatusV2, TransportMode } from '../src/types/enums'
import { eq, isNull, and, like } from 'drizzle-orm'

const TARGET_EMAIL = 'juadebgabriel@gmail.com'
const SEED_CLERK_ID = 'seed_dashboard_gabriel2'
const SEED_TAG = '[seed-gabriel2]'   // unique tag — only this user's seed orders carry it

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(days: number, hourOffset = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(d.getHours() + hourOffset)
  return d
}

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
  transportMode: TransportMode
}> = [
  { origin: 'Shanghai, China',    destination: 'Lagos, Nigeria',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.OCEAN, transportMode: TransportMode.SEA },
  { origin: 'Mumbai, India',      destination: 'Accra, Ghana',     direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR,   transportMode: TransportMode.AIR },
  { origin: 'Singapore',          destination: 'Nairobi, Kenya',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR,   transportMode: TransportMode.AIR },
  { origin: 'Tokyo, Japan',       destination: 'Cairo, Egypt',     direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.OCEAN, transportMode: TransportMode.SEA },
  { origin: 'Dubai, UAE',         destination: 'Lagos, Nigeria',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR,   transportMode: TransportMode.AIR },
  { origin: 'Shenzhen, China',    destination: 'Abuja, Nigeria',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.OCEAN, transportMode: TransportMode.SEA },
  { origin: 'Seoul, South Korea', destination: 'Accra, Ghana',     direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR,   transportMode: TransportMode.AIR },
  { origin: 'Lagos, Nigeria',     destination: 'Shanghai, China',  direction: OrderDirection.INBOUND,  shipmentType: ShipmentType.OCEAN, transportMode: TransportMode.SEA },
  { origin: 'Nairobi, Kenya',     destination: 'Mumbai, India',    direction: OrderDirection.INBOUND,  shipmentType: ShipmentType.AIR,   transportMode: TransportMode.AIR },
  { origin: 'Dubai, UAE',         destination: 'Nairobi, Kenya',   direction: OrderDirection.OUTBOUND, shipmentType: ShipmentType.AIR,   transportMode: TransportMode.AIR },
]

// V2 status helpers — mode-specific staging points
function pickupStatus(mode: TransportMode): ShipmentStatusV2 {
  return mode === TransportMode.AIR
    ? ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT
    : ShipmentStatusV2.DISPATCHED_TO_ORIGIN_PORT
}
function inTransitStatus(mode: TransportMode): ShipmentStatusV2 {
  return mode === TransportMode.AIR
    ? ShipmentStatusV2.FLIGHT_DEPARTED
    : ShipmentStatusV2.VESSEL_DEPARTED
}

// ─── Order templates ──────────────────────────────────────────────────────────

type OrderTemplate = {
  routeIdx: number
  statusV2: ShipmentStatusV2 | 'pickup' | 'in_transit'  // 'pickup'/'in_transit' resolved per route mode
  priority: Priority
  weight: string
  declaredValue: string
  createdDaysAgo: number
  departureDaysAgo?: number
  etaDaysFromNow?: number
  amount?: string
}

const TEMPLATES: OrderTemplate[] = [
  // ── warehouse verified / pending (4) ──
  { routeIdx: 0, statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, priority: Priority.STANDARD, weight: '12.50', declaredValue: '45000', createdDaysAgo: 2 },
  { routeIdx: 1, statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, priority: Priority.EXPRESS,  weight: '3.20',  declaredValue: '28000', createdDaysAgo: 1 },
  { routeIdx: 2, statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, priority: Priority.ECONOMY,  weight: '7.80',  declaredValue: '15000', createdDaysAgo: 3 },
  { routeIdx: 5, statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, priority: Priority.STANDARD, weight: '5.50',  declaredValue: '32000', createdDaysAgo: 1 },

  // ── dispatched / picked up (3) ──
  { routeIdx: 3, statusV2: 'pickup', priority: Priority.EXPRESS,  weight: '18.00', declaredValue: '85000', createdDaysAgo: 5,  departureDaysAgo: 2 },
  { routeIdx: 4, statusV2: 'pickup', priority: Priority.STANDARD, weight: '4.50',  declaredValue: '21000', createdDaysAgo: 4,  departureDaysAgo: 1 },
  { routeIdx: 6, statusV2: 'pickup', priority: Priority.ECONOMY,  weight: '9.00',  declaredValue: '38000', createdDaysAgo: 6,  departureDaysAgo: 3 },

  // ── in transit (8) ──
  { routeIdx: 0, statusV2: 'in_transit', priority: Priority.STANDARD, weight: '22.50', declaredValue: '95000',  createdDaysAgo: 12, departureDaysAgo: 9,  etaDaysFromNow: 8  },
  { routeIdx: 1, statusV2: 'in_transit', priority: Priority.EXPRESS,  weight: '6.30',  declaredValue: '42000',  createdDaysAgo: 10, departureDaysAgo: 7,  etaDaysFromNow: 3  },
  { routeIdx: 2, statusV2: 'in_transit', priority: Priority.ECONOMY,  weight: '15.00', declaredValue: '55000',  createdDaysAgo: 15, departureDaysAgo: 12, etaDaysFromNow: 10 },
  { routeIdx: 3, statusV2: 'in_transit', priority: Priority.STANDARD, weight: '8.70',  declaredValue: '31000',  createdDaysAgo: 8,  departureDaysAgo: 5,  etaDaysFromNow: 5  },
  { routeIdx: 4, statusV2: 'in_transit', priority: Priority.EXPRESS,  weight: '30.00', declaredValue: '120000', createdDaysAgo: 20, departureDaysAgo: 17, etaDaysFromNow: 6  },
  { routeIdx: 5, statusV2: 'in_transit', priority: Priority.STANDARD, weight: '11.20', declaredValue: '48000',  createdDaysAgo: 9,  departureDaysAgo: 6,  etaDaysFromNow: 4  },
  { routeIdx: 6, statusV2: 'in_transit', priority: Priority.ECONOMY,  weight: '5.80',  declaredValue: '19000',  createdDaysAgo: 18, departureDaysAgo: 15, etaDaysFromNow: -2 },
  { routeIdx: 7, statusV2: 'in_transit', priority: Priority.EXPRESS,  weight: '14.00', declaredValue: '72000',  createdDaysAgo: 22, departureDaysAgo: 19, etaDaysFromNow: -1 },

  // ── in transit to Lagos office (3) ──
  { routeIdx: 0, statusV2: ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE, priority: Priority.EXPRESS,  weight: '3.50',  declaredValue: '25000', createdDaysAgo: 14, departureDaysAgo: 11, etaDaysFromNow: 1  },
  { routeIdx: 1, statusV2: ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE, priority: Priority.STANDARD, weight: '7.20',  declaredValue: '33000', createdDaysAgo: 16, departureDaysAgo: 13, etaDaysFromNow: 0  },
  { routeIdx: 9, statusV2: ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE, priority: Priority.ECONOMY,  weight: '20.00', declaredValue: '68000', createdDaysAgo: 18, departureDaysAgo: 15, etaDaysFromNow: 1  },

  // ── delivered (5) ──
  { routeIdx: 2, statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, priority: Priority.STANDARD, weight: '4.80',  declaredValue: '18000', createdDaysAgo: 28, departureDaysAgo: 25, etaDaysFromNow: -20, amount: '52000' },
  { routeIdx: 3, statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, priority: Priority.EXPRESS,  weight: '9.50',  declaredValue: '67000', createdDaysAgo: 25, departureDaysAgo: 22, etaDaysFromNow: -17, amount: '78000' },
  { routeIdx: 4, statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, priority: Priority.ECONOMY,  weight: '16.00', declaredValue: '43000', createdDaysAgo: 29, departureDaysAgo: 26, etaDaysFromNow: -21, amount: '61000' },
  { routeIdx: 0, statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, priority: Priority.STANDARD, weight: '6.20',  declaredValue: '29000', createdDaysAgo: 20, departureDaysAgo: 17, etaDaysFromNow: -12, amount: '45000' },
  { routeIdx: 8, statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, priority: Priority.EXPRESS,  weight: '2.80',  declaredValue: '12000', createdDaysAgo: 22, departureDaysAgo: 19, etaDaysFromNow: -15, amount: '38000' },

  // ── cancelled (1) ──
  { routeIdx: 5, statusV2: ShipmentStatusV2.CANCELLED, priority: Priority.STANDARD, weight: '10.00', declaredValue: '37000', createdDaysAgo: 10 },

  // ── cancelled — previously returned (1) ──
  { routeIdx: 6, statusV2: ShipmentStatusV2.CANCELLED, priority: Priority.ECONOMY, weight: '8.00', declaredValue: '26000', createdDaysAgo: 25, departureDaysAgo: 22, etaDaysFromNow: -15 },
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
    const [byClerk] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, SEED_CLERK_ID))
      .limit(1)

    if (byClerk) {
      user = byClerk
    } else {
      const [created] = await db
        .insert(users)
        .values({
          clerkId: SEED_CLERK_ID,
          email: encrypt(TARGET_EMAIL),
          emailHash,
          firstName: encrypt('Ju'),
          lastName: encrypt('Gabriel'),
          phone: encrypt('+2348099887700'),
          whatsappNumber: encrypt('+2348099887700'),
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

  // ── 3. Remove ONLY this user's previous seed orders (tagged [seed-gabriel2]) ─
  // Double-filtered: senderId = this user AND description contains the unique tag.
  // Cannot touch any other customer's orders.
  const existingOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(
      eq(orders.senderId, userId),           // only this user
      like(orders.description, `%${SEED_TAG}%`),  // only seed-tagged orders
    ))

  if (existingOrders.length > 0) {
    const ids = existingOrders.map((o) => o.id)
    for (const id of ids) {
      await db.delete(payments).where(eq(payments.orderId, id))
    }
    for (const id of ids) {
      await db.delete(orders).where(eq(orders.id, id))
    }
    console.log(`  🧹  Removed ${ids.length} previous seed orders (only ${TARGET_EMAIL}'s tagged orders)`)
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

    const resolvedStatusV2: ShipmentStatusV2 =
      tmpl.statusV2 === 'pickup' ? pickupStatus(route.transportMode)
      : tmpl.statusV2 === 'in_transit' ? inTransitStatus(route.transportMode)
      : tmpl.statusV2

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
        statusV2: resolvedStatusV2,
        customerStatusV2: resolvedStatusV2,
        transportMode: route.transportMode,
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
    const ref = `GB2-${Math.random().toString(36).slice(2, 12).toUpperCase()}`
    await db.insert(payments).values({
      orderId,
      userId,
      amount,
      currency: 'NGN',
      paystackReference: ref,
      paystackTransactionId: `gabriel2_txn_${ref.toLowerCase()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: new Date(),
    })
  }

  console.log(`  ✅  Payments: ${ordersWithPayment.length} successful payments`)

  const statusSummary = TEMPLATES.reduce(
    (acc, t) => { const k = String(t.statusV2); acc[k] = (acc[k] ?? 0) + 1; return acc },
    {} as Record<string, number>,
  )

  console.log('\n✅  Done!\n')
  console.log('    Orders by statusV2:')
  for (const [status, count] of Object.entries(statusSummary)) {
    console.log(`      • ${status.padEnd(32)} ${count}`)
  }
  console.log(`\n    User id: ${userId}\n`)

  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err)
  process.exit(1)
})
