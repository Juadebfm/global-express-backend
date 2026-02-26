/**
 * Seed script — inserts 5 test customers, 30 orders (across all statuses), and payments.
 *
 * Usage:
 *   npm run seed:data
 *
 * Prerequisites:
 *   - Run "npm run seed:superadmin" first (seed orders use the superadmin as createdBy)
 *   - Run "npm run db:push" to ensure all tables exist
 *
 * Safe to inspect: checks for existing seed data and aborts if already seeded.
 * To re-seed, delete rows with clerk_id LIKE 'seed_data_v1_%' from the users table.
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { users, orders, payments } from '../drizzle/schema'
import { encrypt } from '../src/utils/encryption'
import { generateTrackingNumber } from '../src/utils/tracking'
import { UserRole, OrderDirection, PaymentStatus, ShipmentStatusV2, TransportMode } from '../src/types/enums'
import { eq, isNull, and } from 'drizzle-orm'

const SEED_MARKER = 'seed_data_v1'

// ─── Customer data ───────────────────────────────────────────────────────────

const CUSTOMERS = [
  {
    clerkId: `${SEED_MARKER}_user_1`,
    email: 'chidi.okonkwo@testmail.com',
    firstName: 'Chidi',
    lastName: 'Okonkwo',
    phone: '+2348012345678',
    whatsappNumber: '+2348012345678',
    addressStreet: '14 Broad Street, Lagos Island',
    addressCity: 'Lagos',
    addressState: 'Lagos',
    addressCountry: 'Nigeria',
    addressPostalCode: '100001',
  },
  {
    clerkId: `${SEED_MARKER}_user_2`,
    email: 'amara.nwosu@testmail.com',
    firstName: 'Amara',
    lastName: 'Nwosu',
    phone: '+2348023456789',
    whatsappNumber: '+2348023456789',
    addressStreet: '22 Wuse II, Zone 5',
    addressCity: 'Abuja',
    addressState: 'FCT',
    addressCountry: 'Nigeria',
    addressPostalCode: '900001',
  },
  {
    clerkId: `${SEED_MARKER}_user_3`,
    email: 'fatima.alhassan@testmail.com',
    firstName: 'Fatima',
    lastName: 'Al-Hassan',
    phone: '+2348034567890',
    whatsappNumber: '+2348034567890',
    addressStreet: '5 Katsina Road, Bompai',
    addressCity: 'Kano',
    addressState: 'Kano',
    addressCountry: 'Nigeria',
    addressPostalCode: '700001',
  },
  {
    clerkId: `${SEED_MARKER}_user_4`,
    email: 'emeka.eze@testmail.com',
    firstName: 'Emeka',
    lastName: 'Eze',
    phone: '+2348045678901',
    whatsappNumber: '+2348045678901',
    addressStreet: '8 Trans-Amadi Road',
    addressCity: 'Port Harcourt',
    addressState: 'Rivers',
    addressCountry: 'Nigeria',
    addressPostalCode: '500001',
  },
  {
    clerkId: `${SEED_MARKER}_user_5`,
    email: 'ngozi.adeyemi@testmail.com',
    firstName: 'Ngozi',
    lastName: 'Adeyemi',
    phone: '+2348056789012',
    whatsappNumber: '+2348056789012',
    addressStreet: '3 Ring Road, Bodija',
    addressCity: 'Ibadan',
    addressState: 'Oyo',
    addressCountry: 'Nigeria',
    addressPostalCode: '200001',
  },
]

// ─── Recipient pool (rotated across orders) ──────────────────────────────────

const RECIPIENTS = [
  { name: 'Adeola Johnson', address: '5 Victoria Island', phone: '+2348098765432', email: 'adeola@testmail.com' },
  { name: 'Bola Williams', address: '12 Maitama District', phone: '+2348087654321', email: 'bola@testmail.com' },
  { name: 'Chibuzor Obi', address: '3 GRA Phase 2, PH', phone: '+2348076543210', email: null },
  { name: 'Damilola Adeleke', address: '7 New Haven Estate, Enugu', phone: '+2348065432109', email: 'dami@testmail.com' },
  { name: 'Esther Babatunde', address: '9 Ogui Road, Enugu', phone: '+2348054321098', email: null },
]

// ─── Package pool (rotated across orders) ────────────────────────────────────

const PACKAGES = [
  { weight: '2.50', declaredValue: '15000', description: 'Electronics — phone and accessories' },
  { weight: '5.00', declaredValue: '35000', description: 'Clothing and textiles' },
  { weight: '1.20', declaredValue: '8500', description: 'Documents and books' },
  { weight: '8.00', declaredValue: '65000', description: 'Electronics — laptop' },
  { weight: '3.50', declaredValue: '22000', description: 'Cosmetics and toiletries' },
]

// ─── Order templates (30 total) ───────────────────────────────────────────────
// customerIdx references CUSTOMERS array (0-4)
// amount is only set for delivered orders (triggers payment seeding)

type OrderTemplate = {
  statusV2: ShipmentStatusV2
  origin: string
  destination: string
  direction: OrderDirection
  customerIdx: number
  amount?: string
}

const ORDER_TEMPLATES: OrderTemplate[] = [
  // warehouse verified / priced (4)
  { statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 0 },
  { statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 1 },
  { statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.INBOUND,  customerIdx: 2 },
  { statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 3 },

  // dispatched to airport (4)
  { statusV2: ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 4 },
  { statusV2: ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 0 },
  { statusV2: ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.INBOUND,  customerIdx: 1 },
  { statusV2: ShipmentStatusV2.DISPATCHED_TO_ORIGIN_AIRPORT, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 2 },

  // flight departed (6)
  { statusV2: ShipmentStatusV2.FLIGHT_DEPARTED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 3 },
  { statusV2: ShipmentStatusV2.FLIGHT_DEPARTED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 4 },
  { statusV2: ShipmentStatusV2.FLIGHT_DEPARTED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 0 },
  { statusV2: ShipmentStatusV2.FLIGHT_DEPARTED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.INBOUND,  customerIdx: 1 },
  { statusV2: ShipmentStatusV2.FLIGHT_DEPARTED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 2 },
  { statusV2: ShipmentStatusV2.FLIGHT_DEPARTED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 3 },

  // in transit to Lagos office (4)
  { statusV2: ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 4 },
  { statusV2: ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 0 },
  { statusV2: ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 1 },
  { statusV2: ShipmentStatusV2.IN_TRANSIT_TO_LAGOS_OFFICE, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 2 },

  // delivered (8) — all get payments
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 3, amount: '45000' },
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 4, amount: '38000' },
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 0, amount: '52000' },
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 1, amount: '29000' },
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 2, amount: '61000' },
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.INBOUND,  customerIdx: 3, amount: '33000' },
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.INBOUND,  customerIdx: 4, amount: '47000' },
  { statusV2: ShipmentStatusV2.PICKED_UP_COMPLETED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 0, amount: '55000' },

  // cancelled (2)
  { statusV2: ShipmentStatusV2.CANCELLED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 1 },
  { statusV2: ShipmentStatusV2.CANCELLED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 2 },

  // cancelled — previously returned (2)
  { statusV2: ShipmentStatusV2.CANCELLED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 3 },
  { statusV2: ShipmentStatusV2.CANCELLED, origin: 'Seoul, South Korea', destination: 'Lagos, Nigeria', direction: OrderDirection.OUTBOUND, customerIdx: 4 },
]

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Guard: abort if already seeded
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, `${SEED_MARKER}_user_1`))
    .limit(1)

  if (existing) {
    console.log('\n⚠️  Seed data already exists. Skipping.')
    console.log('    To re-seed, delete rows WHERE clerk_id LIKE \'seed_data_v1_%\' from the users table.\n')
    process.exit(0)
  }

  // Require a superadmin to exist (used as createdBy on all orders)
  const [superadmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, UserRole.SUPERADMIN), isNull(users.deletedAt)))
    .limit(1)

  if (!superadmin) {
    console.error('\n❌  No superadmin found. Run "npm run seed:superadmin" first.\n')
    process.exit(1)
  }

  console.log('\n🌱  Seeding test data...\n')

  // ── 1. Insert customers ────────────────────────────────────────────────────

  const customerIds: string[] = []

  for (const c of CUSTOMERS) {
    const [user] = await db
      .insert(users)
      .values({
        clerkId: c.clerkId,
        email: encrypt(c.email),
        firstName: encrypt(c.firstName),
        lastName: encrypt(c.lastName),
        phone: encrypt(c.phone),
        whatsappNumber: encrypt(c.whatsappNumber),
        addressStreet: encrypt(c.addressStreet),
        addressCity: c.addressCity,
        addressState: c.addressState,
        addressCountry: c.addressCountry,
        addressPostalCode: c.addressPostalCode,
        role: UserRole.USER,
        isActive: true,
        consentMarketing: true,
      })
      .returning({ id: users.id })

    customerIds.push(user.id)
    console.log(`  ✅  Customer: ${c.firstName} ${c.lastName} (${c.email})`)
  }

  // ── 2. Insert orders ───────────────────────────────────────────────────────

  const ordersWithPayment: Array<{ orderId: string; amount: string; userId: string }> = []

  for (let i = 0; i < ORDER_TEMPLATES.length; i++) {
    const tmpl = ORDER_TEMPLATES[i]
    const pkg = PACKAGES[i % PACKAGES.length]
    const recipient = RECIPIENTS[i % RECIPIENTS.length]
    const customerId = customerIds[tmpl.customerIdx]

    const [order] = await db
      .insert(orders)
      .values({
        trackingNumber: generateTrackingNumber(),
        senderId: customerId,
        recipientName: encrypt(recipient.name),
        recipientAddress: encrypt(recipient.address),
        recipientPhone: encrypt(recipient.phone),
        recipientEmail: recipient.email ? encrypt(recipient.email) : null,
        origin: tmpl.origin,
        destination: tmpl.destination,
        statusV2: tmpl.statusV2,
        customerStatusV2: tmpl.statusV2,
        transportMode: TransportMode.AIR,
        orderDirection: tmpl.direction,
        weight: pkg.weight,
        declaredValue: pkg.declaredValue,
        description: pkg.description,
        createdBy: superadmin.id,
      })
      .returning({ id: orders.id })

    if (tmpl.amount) {
      ordersWithPayment.push({ orderId: order.id, amount: tmpl.amount, userId: customerId })
    }
  }

  console.log(`\n  ✅  Orders: ${ORDER_TEMPLATES.length} created across all statuses`)

  // ── 3. Insert payments (for delivered orders) ──────────────────────────────

  for (const { orderId, amount, userId } of ordersWithPayment) {
    const ref = `SEED-${Math.random().toString(36).slice(2, 12).toUpperCase()}`
    await db.insert(payments).values({
      orderId,
      userId,
      amount,
      currency: 'NGN',
      paystackReference: ref,
      paystackTransactionId: `seed_txn_${ref.toLowerCase()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: new Date(),
    })
  }

  console.log(`  ✅  Payments: ${ordersWithPayment.length} successful payments`)

  console.log('\n✅  Seed complete!\n')
  console.log('    Summary:')
  console.log(`      • ${CUSTOMERS.length} test customers`)
  console.log(`      • ${ORDER_TEMPLATES.length} orders`)
  console.log(`        - WAREHOUSE_VERIFIED_PRICED: 4, DISPATCHED_TO_ORIGIN_AIRPORT: 4, FLIGHT_DEPARTED: 6`)
  console.log(`        - IN_TRANSIT_TO_LAGOS_OFFICE: 4, PICKED_UP_COMPLETED: 8, CANCELLED: 4`)
  console.log(`      • ${ordersWithPayment.length} successful payments`)
  console.log('\n    Login credentials for test customers are in scripts/seed-data.ts')
  console.log('    (Clerk accounts are faked — use clerkId directly if needed for testing)\n')

  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err)
  process.exit(1)
})
