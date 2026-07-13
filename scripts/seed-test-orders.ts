/**
 * Creates a test customer + 3 sample orders (sea, air, d2d) for batch testing.
 * Run: npx tsx scripts/seed-test-orders.ts
 */
import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'
import { randomBytes } from 'crypto'
import { createCipheriv, createHmac, randomBytes as rb } from 'crypto'

const DATABASE_URL = process.env.DATABASE_URL!
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!
const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 })
let localTrackingSequence = 0

function generateTrackingNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  localTrackingSequence += 1
  return `${date}-${String(localTrackingSequence).padStart(4, '0')}`
}

function encrypt(text: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = rb(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let ciphertext = cipher.update(text, 'utf8', 'hex')
  ciphertext += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`
}

function emailHash(email: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  return createHmac('sha256', key).update(email.toLowerCase()).digest('hex')
}

async function main() {
  // ── 1. Create test customer ──────────────────────────────────────────────
  const testEmail = 'test.batch.customer@globalexpress.local'
  const hash = emailHash(testEmail)

  const existing = await sql`SELECT id FROM users WHERE email_hash = ${hash} LIMIT 1`
  let customerId: string

  if (existing.length > 0) {
    customerId = existing[0].id
    console.log(`Test customer already exists: ${customerId}`)
  } else {
    const shippingMark = `GE-TB-${randomBytes(3).toString('hex').toUpperCase()}`
    const [customer] = await sql`
      INSERT INTO users (
        email, email_hash, first_name, last_name,
        role, is_active, shipping_mark,
        created_at, updated_at
      ) VALUES (
        ${encrypt(testEmail)}, ${hash},
        ${encrypt('Test')}, ${encrypt('BatchCustomer')},
        'user', true, ${encrypt(shippingMark)},
        NOW(), NOW()
      )
      RETURNING id, shipping_mark
    `
    customerId = customer.id
    console.log(`Created test customer: ${customerId} (${customer.shipping_mark})`)
  }

  // ── 2. Seed 3 orders ─────────────────────────────────────────────────────
  const orders = [
    {
      label: 'Sea freight',
      shipmentType: 'ocean',
      transportMode: 'sea',
      description: 'Household items — kitchenware and clothing',
      weight: '12.500',
      declaredValue: '85.00',
    },
    {
      label: 'Air freight',
      shipmentType: 'air',
      transportMode: 'air',
      description: 'Electronics — smartwatch and accessories',
      weight: '1.200',
      declaredValue: '320.00',
    },
    {
      label: 'Door-to-door (D2D)',
      shipmentType: 'd2d',
      transportMode: 'air',
      description: 'Fashion items — shoes and bags',
      weight: '3.800',
      declaredValue: '150.00',
    },
  ]

  const [admin] = await sql`SELECT id FROM users WHERE role = 'superadmin' LIMIT 1`

  for (const order of orders) {
    const trackingNumber = generateTrackingNumber()

    const [created] = await sql`
      INSERT INTO orders (
        sender_id,
        tracking_number,
        recipient_name, recipient_phone, recipient_address,
        description, weight, declared_value,
        shipment_type, transport_mode,
        status_v2,
        order_direction,
        origin, destination,
        is_preorder,
        created_by,
        created_at, updated_at
      ) VALUES (
        ${customerId},
        ${trackingNumber},
        ${encrypt('Oluwafemi')}, ${encrypt('07043641234')}, ${encrypt('Maryland, Mende 44, Lagos')},
        ${order.description}, ${order.weight}, ${order.declaredValue},
        ${order.shipmentType}, ${order.transportMode},
        'PREORDER_SUBMITTED',
        'outbound',
        'South Korea', 'Nigeria',
        true,
        ${admin.id},
        NOW(), NOW()
      )
      RETURNING id, tracking_number
    `
    console.log(`✓ ${order.label}: ${created.tracking_number} (id: ${created.id})`)
  }

  await sql.end()
  console.log('\nDone. All 3 orders are at PREORDER_SUBMITTED status.')
  console.log('Promote them to WAREHOUSE_VERIFIED_PRICED to test batch operations.')
}

main().catch(e => { console.error(e); process.exit(1) })
