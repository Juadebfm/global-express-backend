/**
 * Clear all shipment/order data, remove Taiwo Hassan, and reseed with
 * realistic test data covering every pipeline stage.
 *
 * Run with: npx tsx scripts/clear-and-reseed.mts
 */

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import postgres from 'postgres'

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env')
const envContent = readFileSync(envPath, 'utf8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx < 0) continue
  process.env[trimmed.slice(0, idx).trim()] ??= trimmed.slice(idx + 1).trim()
}

const DATABASE_URL = process.env['DATABASE_URL']!
const ENC_KEY = process.env['ENCRYPTION_KEY']!

if (!DATABASE_URL || ENC_KEY?.length !== 64) throw new Error('Missing DATABASE_URL or ENCRYPTION_KEY (64 hex chars)')

// ─── Crypto helpers ────────────────────────────────────────────────────────────
function enc(plaintext: string): string {
  const key = Buffer.from(ENC_KEY, 'hex')
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let ct = cipher.update(plaintext, 'utf8', 'hex')
  ct += cipher.final('hex')
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct}`
}

function tryDecrypt(encrypted: string): string | null {
  try {
    const parts = encrypted.split(':')
    if (parts.length !== 3) return null
    const [ivHex, tagHex, ct] = parts
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ENC_KEY, 'hex'), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    let out = decipher.update(ct, 'hex', 'utf8')
    out += decipher.final('utf8')
    return out
  } catch {
    return null
  }
}

/** Find a user by decrypting their stored email field. Returns null if not found. */
async function findUserByEmail(emailToFind: string): Promise<string | null> {
  const rows = await sql<Array<{ id: string; email: string }>>`
    SELECT id, email FROM users WHERE deleted_at IS NULL
  `
  const lower = emailToFind.toLowerCase()
  for (const r of rows) {
    if (tryDecrypt(r.email)?.toLowerCase() === lower) return r.id
  }
  return null
}

function tempTrk(): string {
  return `TEMP-${randomBytes(8).toString('hex').toUpperCase()}`
}

function slotTrk(batchDate: Date, position: number): string {
  const y = batchDate.getUTCFullYear()
  const m = String(batchDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(batchDate.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}-${String(position).padStart(4, '0')}`
}

function masterTrk(mode: 'air' | 'sea', batchDate: Date, seq: number): string {
  const y = batchDate.getUTCFullYear()
  const m = String(batchDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(batchDate.getUTCDate()).padStart(2, '0')
  return `${mode.toUpperCase()}-${y}${m}${d}-${String(seq).padStart(4, '0')}`
}

// ─── DB connection ─────────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 })

async function main() {
  // ════════════════════════════════════════════════════════════
  // PHASE 1 — CLEAR SHIPMENT DATA
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 1: Clearing shipment data ──')

  // Delete in FK-safe order. Tables with onDelete: 'cascade' don't need explicit deletion
  // but we include them for completeness and speed.
  await sql`DELETE FROM notifications`
  console.log('  ✓ notifications')

  await sql`DELETE FROM payments`
  console.log('  ✓ payments')

  // invoice_attachments cascade from invoices and orders; delete invoices first
  await sql`DELETE FROM invoices`
  console.log('  ✓ invoices (+ invoice_attachments cascade)')

  await sql`DELETE FROM supplier_declarations`
  console.log('  ✓ supplier_declarations')

  await sql`DELETE FROM batch_documents`
  console.log('  ✓ batch_documents')

  await sql`DELETE FROM batch_customer_slots`
  console.log('  ✓ batch_customer_slots')

  // orders cascade: order_status_events, shipment_measurements, order_packages, invoice_attachments
  await sql`DELETE FROM orders`
  console.log('  ✓ orders (+ cascades)')

  await sql`DELETE FROM dispatch_batches`
  console.log('  ✓ dispatch_batches')

  await sql`DELETE FROM support_tickets`
  console.log('  ✓ support_tickets')

  // ════════════════════════════════════════════════════════════
  // PHASE 2 — REMOVE TAIWO HASSAN
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 2: Removing Taiwo Hassan ──')

  const taiwoId = await findUserByEmail('hazyom@gmail.com')

  if (taiwoId) {
    await sql`DELETE FROM audit_logs WHERE user_id = ${taiwoId}`
    await sql`DELETE FROM users WHERE id = ${taiwoId}`
    console.log(`  ✓ Removed Taiwo Hassan (${taiwoId})`)
  } else {
    console.log('  ⚠ Taiwo Hassan not found — already removed')
  }

  // ════════════════════════════════════════════════════════════
  // PHASE 3 — FIND ADMIN USER (Dele)
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 3: Finding admin user ──')

  const deleId = await findUserByEmail('juadebgabriel@gmail.com')
  if (!deleId) throw new Error('Dele Adebowale not found — cannot seed without admin user')
  console.log(`  ✓ Admin: ${deleId}`)

  // ════════════════════════════════════════════════════════════
  // PHASE 4 — CREATE SEED USERS
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 4: Creating seed users ──')

  // Remove any leftover seed users from a previous run
  await sql`DELETE FROM users WHERE clerk_id IN ('user_seed_amaka001','user_seed_seun001','user_seed_tope001','user_seed_kim001')`

  const amakaId = randomUUID()
  const seunId  = randomUUID()
  const topeId  = randomUUID()
  const kimId   = randomUUID()

  const now = new Date()

  // Amaka Okonkwo — customer (Lagos)
  await sql`
    INSERT INTO users
      (id, clerk_id, email, first_name, last_name, phone, shipping_mark,
       role, address_city, address_state, address_country, created_at, updated_at)
    VALUES (
      ${amakaId}, 'user_seed_amaka001',
      ${enc('amaka.okonkwo@gmail.com')},
      ${enc('Amaka')}, ${enc('Okonkwo')},
      ${enc('+2348031234567')},
      ${enc('AmakaO')},
      'user', 'Lagos', 'Lagos', 'Nigeria',
      ${now}, ${now}
    )
  `
  console.log(`  ✓ Amaka Okonkwo (${amakaId})  mark: AmakaO`)

  // Seun Bello — customer (Abuja)
  await sql`
    INSERT INTO users
      (id, clerk_id, email, first_name, last_name, phone, shipping_mark,
       role, address_city, address_state, address_country, created_at, updated_at)
    VALUES (
      ${seunId}, 'user_seed_seun001',
      ${enc('seun.bello@outlook.com')},
      ${enc('Seun')}, ${enc('Bello')},
      ${enc('+2348052345678')},
      ${enc('SeunB')},
      'user', 'Abuja', 'FCT', 'Nigeria',
      ${now}, ${now}
    )
  `
  console.log(`  ✓ Seun Bello   (${seunId})  mark: SeunB`)

  // Tope Adeyemi — customer (Port Harcourt)
  await sql`
    INSERT INTO users
      (id, clerk_id, email, first_name, last_name, phone, shipping_mark,
       role, address_city, address_state, address_country, created_at, updated_at)
    VALUES (
      ${topeId}, 'user_seed_tope001',
      ${enc('tope.adeyemi@yahoo.com')},
      ${enc('Tope')}, ${enc('Adeyemi')},
      ${enc('+2348074567890')},
      ${enc('TopeA')},
      'user', 'Port Harcourt', 'Rivers', 'Nigeria',
      ${now}, ${now}
    )
  `
  console.log(`  ✓ Tope Adeyemi (${topeId})  mark: TopeA`)

  // Kim Electronics — supplier (Seoul)
  await sql`
    INSERT INTO users
      (id, clerk_id, email, first_name, last_name, business_name, phone,
       role, address_city, address_state, address_country, created_at, updated_at)
    VALUES (
      ${kimId}, 'user_seed_kim001',
      ${enc('orders@kim-electronics.kr')},
      ${enc('Jinhyun')}, ${enc('Kim')},
      ${enc('Kim Electronics Co.')},
      ${enc('+821012345678')},
      'supplier', 'Seoul', 'Seoul', 'South Korea',
      ${now}, ${now}
    )
  `
  console.log(`  ✓ Kim Electronics (${kimId})  supplier`)

  // Link Kim ↔ Amaka and Kim ↔ Seun
  await sql`
    INSERT INTO user_suppliers (id, user_id, supplier_id, linked_by_user_id, created_at, updated_at)
    VALUES
      (${randomUUID()}, ${amakaId}, ${kimId}, ${deleId}, ${now}, ${now}),
      (${randomUUID()}, ${seunId},  ${kimId}, ${deleId}, ${now}, ${now})
  `
  console.log('  ✓ user_suppliers: Kim ↔ Amaka, Kim ↔ Seun')

  // ════════════════════════════════════════════════════════════
  // PHASE 5 — CREATE DISPATCH BATCHES
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 5: Creating batches ──')

  const openAirDate    = new Date('2026-06-20T08:00:00Z')
  const openSeaDate    = new Date('2026-06-18T08:00:00Z')
  const closed1Date    = new Date('2026-06-10T08:00:00Z')
  const closed2Date    = new Date('2026-06-01T08:00:00Z')
  const closed3Date    = new Date('2026-05-25T08:00:00Z')

  const openAirId  = randomUUID()
  const openSeaId  = randomUUID()
  const closed1Id  = randomUUID()
  const closed2Id  = randomUUID()
  const closed3Id  = randomUUID()

  const openAirMTN  = masterTrk('air', openAirDate, 3)   // AIR-20260620-0003
  const openSeaMTN  = masterTrk('sea', openSeaDate, 1)   // SEA-20260618-0001
  const closed1MTN  = masterTrk('air', closed1Date, 2)   // AIR-20260610-0002
  const closed2MTN  = masterTrk('air', closed2Date, 1)   // AIR-20260601-0001
  const closed3MTN  = masterTrk('air', closed3Date, 1)   // AIR-20260525-0001

  await sql`
    INSERT INTO dispatch_batches
      (id, master_tracking_number, transport_mode, status, slot_counter,
       voyage_or_flight_number, carrier_name, created_by, created_at, updated_at)
    VALUES
      (${openAirId},  ${openAirMTN},  'air', 'open',   2, 'KE623',  'Korean Air',    ${deleId}, ${openAirDate}, ${now}),
      (${openSeaId},  ${openSeaMTN},  'sea', 'open',   1, 'V.219N', 'HMM Shipping',  ${deleId}, ${openSeaDate}, ${now}),
      (${closed1Id},  ${closed1MTN},  'air', 'closed', 2, 'KE621',  'Korean Air',    ${deleId}, ${closed1Date}, ${now}),
      (${closed2Id},  ${closed2MTN},  'air', 'closed', 2, 'OZ501',  'Asiana Airlines', ${deleId}, ${closed2Date}, ${now}),
      (${closed3Id},  ${closed3MTN},  'air', 'closed', 1, 'KE619',  'Korean Air',    ${deleId}, ${closed3Date}, ${now})
  `

  console.log(`  ✓ ${openAirMTN}  (open air,  2 slots)`)
  console.log(`  ✓ ${openSeaMTN}  (open sea,  1 slot)`)
  console.log(`  ✓ ${closed1MTN}  (closed air, 2 slots — in transit)`)
  console.log(`  ✓ ${closed2MTN}  (closed air, 2 slots — final mile)`)
  console.log(`  ✓ ${closed3MTN}  (closed air, 1 slot  — completed)`)

  // ════════════════════════════════════════════════════════════
  // PHASE 6 — CREATE ORDERS
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 6: Creating orders ──')

  // Pre-encrypt PII for each recipient
  const amakaRecipient = {
    name:    enc('Amaka Okonkwo'),
    address: enc('15 Adeola Odeku Street, Victoria Island, Lagos'),
    phone:   enc('+2348031234567'),
  }
  const seunRecipient = {
    name:    enc('Seun Bello'),
    address: enc('23 Aguiyi Ironsi Street, Maitama, Abuja'),
    phone:   enc('+2348052345678'),
  }
  const topeRecipient = {
    name:    enc('Tope Adeyemi'),
    address: enc('7 Stadium Road, Port Harcourt, Rivers State'),
    phone:   enc('+2348074567890'),
  }

  // ── TODAY'S ARRIVALS (AWAITING_WAREHOUSE_RECEIPT, created today) ──
  const o1Id = randomUUID(); const o1Trk = tempTrk()
  const o2Id = randomUUID(); const o2Trk = tempTrk()

  // ── NEEDS ACTION ──
  const o3Id = randomUUID(); const o3Trk = tempTrk()  // WAREHOUSE_RECEIVED
  const o4Id = randomUUID(); const o4Trk = tempTrk()  // ON_HOLD (flagged)
  const o5Id = randomUUID(); const o5Trk = tempTrk()  // WAREHOUSE_VERIFIED_PRICED, no batch

  // ── IN BATCH — Open Air (Seun + Tope) ──
  const o6Id = randomUUID(); const o6Trk = tempTrk()  // Seun, slot 1
  const o7Id = randomUUID(); const o7Trk = tempTrk()  // Tope, slot 2

  // ── IN BATCH — Open Sea (Amaka) ──
  const o8Id = randomUUID(); const o8Trk = tempTrk()  // Amaka, slot 1

  // ── DISPATCHED — Closed batch 1 (Amaka + Seun, in transit) ──
  const o9Id  = randomUUID(); const o9Trk  = tempTrk()  // Amaka, FLIGHT_DEPARTED
  const o10Id = randomUUID(); const o10Trk = tempTrk()  // Seun,  AT_ORIGIN_AIRPORT

  // ── DISPATCHED — Closed batch 2 (Tope + Amaka, final mile) ──
  const o11Id = randomUUID(); const o11Trk = tempTrk()  // Tope,  CUSTOMS_CLEARED_LAGOS
  const o12Id = randomUUID(); const o12Trk = tempTrk()  // Amaka, READY_FOR_PICKUP (supplier-sourced)

  // ── COMPLETED — Closed batch 3 (Seun, delivered) ──
  const o13Id = randomUUID(); const o13Trk = tempTrk()  // Seun,  DELIVERED_TO_RECIPIENT

  // Helper: insert a single order
  type OrderInput = {
    id: string; trk: string; senderId: string
    rName: string; rAddress: string; rPhone: string
    weight: string; value: string; description: string
    mode: 'air' | 'sea'; type: 'air' | 'ocean' | 'd2d'
    status: string
    batchId?: string
    flagged?: boolean
    sourcingSupId?: string; sourcingSupName?: string; sourcingSupPhone?: string; sourcingSupEmail?: string
    paymentStatus?: string
    pricedAt?: Date; pricedBy?: string; chargeUsd?: string
    createdAt: Date
  }

  async function insertOrder(o: OrderInput) {
    await sql`
      INSERT INTO orders (
        id, tracking_number, sender_id,
        recipient_name, recipient_address, recipient_phone,
        origin, destination,
        weight, declared_value, description,
        transport_mode, shipment_type,
        status_v2, customer_status_v2,
        dispatch_batch_id,
        flagged_for_admin_review,
        sourcing_supplier_id, sourcing_supplier_name, sourcing_supplier_phone, sourcing_supplier_email,
        payment_collection_status,
        price_calculated_at, price_calculated_by, calculated_charge_usd, final_charge_usd, pricing_source,
        created_by, created_at, updated_at
      ) VALUES (
        ${o.id}, ${o.trk}, ${o.senderId},
        ${o.rName}, ${o.rAddress}, ${o.rPhone},
        'Seoul, South Korea', 'Lagos, Nigeria',
        ${o.weight}, ${o.value}, ${o.description},
        ${o.mode}, ${o.type},
        ${o.status}, ${o.status},
        ${o.batchId ?? null},
        ${o.flagged ?? false},
        ${o.sourcingSupId ?? null}, ${o.sourcingSupName ?? null}, ${o.sourcingSupPhone ?? null}, ${o.sourcingSupEmail ?? null},
        ${o.paymentStatus ?? 'UNPAID'},
        ${o.pricedAt ?? null}, ${o.pricedBy ?? null}, ${o.chargeUsd ?? null}, ${o.chargeUsd ?? null},
        ${o.chargeUsd ? 'DEFAULT_RATE' : null},
        ${deleId}, ${o.createdAt}, ${now}
      )
    `
  }

  // === TODAY'S ARRIVALS ===
  await insertOrder({
    id: o1Id, trk: o1Trk, senderId: amakaId,
    rName: amakaRecipient.name, rAddress: amakaRecipient.address, rPhone: amakaRecipient.phone,
    weight: '2.50', value: '150.00',
    description: 'Electronics — iPhone 15 accessories and chargers (3 items)',
    mode: 'air', type: 'air', status: 'AWAITING_WAREHOUSE_RECEIPT',
    createdAt: new Date('2026-06-28T09:15:00Z'),
  })
  console.log(`  ✓ O1  ${o1Trk}  Amaka  AWAITING_WAREHOUSE_RECEIPT`)

  await insertOrder({
    id: o2Id, trk: o2Trk, senderId: seunId,
    rName: seunRecipient.name, rAddress: seunRecipient.address, rPhone: seunRecipient.phone,
    weight: '1.80', value: '89.00',
    description: 'Beauty — Korean skincare set (toner, serum, moisturiser, 10 pieces)',
    mode: 'air', type: 'air', status: 'AWAITING_WAREHOUSE_RECEIPT',
    createdAt: new Date('2026-06-28T11:30:00Z'),
  })
  console.log(`  ✓ O2  ${o2Trk}  Seun   AWAITING_WAREHOUSE_RECEIPT`)

  // === NEEDS ACTION ===
  await insertOrder({
    id: o3Id, trk: o3Trk, senderId: topeId,
    rName: topeRecipient.name, rAddress: topeRecipient.address, rPhone: topeRecipient.phone,
    weight: '15.00', value: '320.00',
    description: 'Household — kitchen appliances (blender, rice cooker, kettle)',
    mode: 'sea', type: 'ocean', status: 'WAREHOUSE_RECEIVED',
    createdAt: new Date('2026-06-25T14:00:00Z'),
  })
  console.log(`  ✓ O3  ${o3Trk}  Tope   WAREHOUSE_RECEIVED`)

  await insertOrder({
    id: o4Id, trk: o4Trk, senderId: seunId,
    rName: seunRecipient.name, rAddress: seunRecipient.address, rPhone: seunRecipient.phone,
    weight: '3.20', value: '210.00',
    description: 'Fashion — designer shoes (2 pairs) and summer clothing',
    mode: 'air', type: 'air', status: 'ON_HOLD',
    flagged: true,
    createdAt: new Date('2026-06-24T10:00:00Z'),
  })
  console.log(`  ✓ O4  ${o4Trk}  Seun   ON_HOLD (flagged)`)

  await insertOrder({
    id: o5Id, trk: o5Trk, senderId: amakaId,
    rName: amakaRecipient.name, rAddress: amakaRecipient.address, rPhone: amakaRecipient.phone,
    weight: '4.50', value: '280.00',
    description: 'Electronics — Samsung Galaxy watch and wireless earbuds',
    mode: 'air', type: 'air', status: 'WAREHOUSE_VERIFIED_PRICED',
    paymentStatus: 'UNPAID',
    pricedAt: new Date('2026-06-23T12:00:00Z'), pricedBy: deleId, chargeUsd: '67.50',
    createdAt: new Date('2026-06-23T09:00:00Z'),
  })
  console.log(`  ✓ O5  ${o5Trk}  Amaka  WAREHOUSE_VERIFIED_PRICED (no batch — needs assignment)`)

  // === IN BATCH — Open Air (Seun slot 1, Tope slot 2) ===
  await insertOrder({
    id: o6Id, trk: o6Trk, senderId: seunId,
    rName: seunRecipient.name, rAddress: seunRecipient.address, rPhone: seunRecipient.phone,
    weight: '2.10', value: '175.00',
    description: 'Electronics — Korean smartwatch (Galaxy Watch 7) and accessories',
    mode: 'air', type: 'air', status: 'WAREHOUSE_VERIFIED_PRICED',
    batchId: openAirId,
    paymentStatus: 'UNPAID',
    pricedAt: new Date('2026-06-19T10:00:00Z'), pricedBy: deleId, chargeUsd: '31.50',
    createdAt: new Date('2026-06-19T08:00:00Z'),
  })
  console.log(`  ✓ O6  ${o6Trk}  Seun   WAREHOUSE_VERIFIED_PRICED  batch:${openAirMTN}`)

  await insertOrder({
    id: o7Id, trk: o7Trk, senderId: topeId,
    rName: topeRecipient.name, rAddress: topeRecipient.address, rPhone: topeRecipient.phone,
    weight: '5.60', value: '420.00',
    description: 'Fashion — luxury handbags and wallets (2 bags, 3 wallets)',
    mode: 'air', type: 'air', status: 'WAREHOUSE_VERIFIED_PRICED',
    batchId: openAirId,
    paymentStatus: 'UNPAID',
    pricedAt: new Date('2026-06-19T10:30:00Z'), pricedBy: deleId, chargeUsd: '84.00',
    createdAt: new Date('2026-06-19T09:00:00Z'),
  })
  console.log(`  ✓ O7  ${o7Trk}  Tope   WAREHOUSE_VERIFIED_PRICED  batch:${openAirMTN}`)

  // === IN BATCH — Open Sea (Amaka slot 1) ===
  await insertOrder({
    id: o8Id, trk: o8Trk, senderId: amakaId,
    rName: amakaRecipient.name, rAddress: amakaRecipient.address, rPhone: amakaRecipient.phone,
    weight: '22.00', value: '680.00',
    description: 'Furniture — ergonomic office chair and standing desk accessories',
    mode: 'sea', type: 'ocean', status: 'WAREHOUSE_VERIFIED_PRICED',
    batchId: openSeaId,
    paymentStatus: 'UNPAID',
    pricedAt: new Date('2026-06-17T11:00:00Z'), pricedBy: deleId, chargeUsd: '110.00',
    createdAt: new Date('2026-06-17T09:00:00Z'),
  })
  console.log(`  ✓ O8  ${o8Trk}  Amaka  WAREHOUSE_VERIFIED_PRICED  batch:${openSeaMTN}`)

  // === DISPATCHED — Closed batch 1: in transit ===
  await insertOrder({
    id: o9Id, trk: o9Trk, senderId: amakaId,
    rName: amakaRecipient.name, rAddress: amakaRecipient.address, rPhone: amakaRecipient.phone,
    weight: '3.80', value: '210.00',
    description: 'Electronics — gaming laptop accessories and peripherals',
    mode: 'air', type: 'air', status: 'FLIGHT_DEPARTED',
    batchId: closed1Id,
    paymentStatus: 'PAID_IN_FULL',
    pricedAt: new Date('2026-06-09T10:00:00Z'), pricedBy: deleId, chargeUsd: '57.00',
    createdAt: new Date('2026-06-08T14:00:00Z'),
  })
  console.log(`  ✓ O9  ${o9Trk}  Amaka  FLIGHT_DEPARTED  batch:${closed1MTN}`)

  await insertOrder({
    id: o10Id, trk: o10Trk, senderId: seunId,
    rName: seunRecipient.name, rAddress: seunRecipient.address, rPhone: seunRecipient.phone,
    weight: '1.20', value: '95.00',
    description: 'Beauty — premium skincare ampoules and eye cream set',
    mode: 'air', type: 'air', status: 'AT_ORIGIN_AIRPORT',
    batchId: closed1Id,
    paymentStatus: 'PAID_IN_FULL',
    pricedAt: new Date('2026-06-09T10:30:00Z'), pricedBy: deleId, chargeUsd: '18.00',
    createdAt: new Date('2026-06-08T15:00:00Z'),
  })
  console.log(`  ✓ O10 ${o10Trk}  Seun   AT_ORIGIN_AIRPORT  batch:${closed1MTN}`)

  // === DISPATCHED — Closed batch 2: final mile ===
  await insertOrder({
    id: o11Id, trk: o11Trk, senderId: topeId,
    rName: topeRecipient.name, rAddress: topeRecipient.address, rPhone: topeRecipient.phone,
    weight: '8.40', value: '350.00',
    description: 'Electronics — portable projector and screen kit',
    mode: 'air', type: 'air', status: 'CUSTOMS_CLEARED_LAGOS',
    batchId: closed2Id,
    paymentStatus: 'PAID_IN_FULL',
    pricedAt: new Date('2026-06-01T09:00:00Z'), pricedBy: deleId, chargeUsd: '126.00',
    createdAt: new Date('2026-05-31T10:00:00Z'),
  })
  console.log(`  ✓ O11 ${o11Trk}  Tope   CUSTOMS_CLEARED_LAGOS  batch:${closed2MTN}`)

  await insertOrder({
    id: o12Id, trk: o12Trk, senderId: amakaId,
    rName: amakaRecipient.name, rAddress: amakaRecipient.address, rPhone: amakaRecipient.phone,
    weight: '1.50', value: '230.00',
    description: 'Electronics — Apple AirPods Pro 2nd Gen and MagSafe charger',
    mode: 'air', type: 'air', status: 'READY_FOR_PICKUP',
    batchId: closed2Id,
    sourcingSupId: kimId,
    sourcingSupName: enc('Kim Electronics Co.'),
    sourcingSupPhone: enc('+821012345678'),
    sourcingSupEmail: enc('orders@kim-electronics.kr'),
    paymentStatus: 'PAID_IN_FULL',
    pricedAt: new Date('2026-06-01T09:30:00Z'), pricedBy: deleId, chargeUsd: '22.50',
    createdAt: new Date('2026-05-30T14:00:00Z'),
  })
  console.log(`  ✓ O12 ${o12Trk}  Amaka  READY_FOR_PICKUP  batch:${closed2MTN}  (supplier: Kim)`)

  // === COMPLETED — Closed batch 3: delivered ===
  await insertOrder({
    id: o13Id, trk: o13Trk, senderId: seunId,
    rName: seunRecipient.name, rAddress: seunRecipient.address, rPhone: seunRecipient.phone,
    weight: '0.90', value: '120.00',
    description: 'Fashion — Korean streetwear clothing set (hoodie, joggers)',
    mode: 'air', type: 'air', status: 'DELIVERED_TO_RECIPIENT',
    batchId: closed3Id,
    paymentStatus: 'PAID_IN_FULL',
    pricedAt: new Date('2026-05-25T09:00:00Z'), pricedBy: deleId, chargeUsd: '13.50',
    createdAt: new Date('2026-05-23T09:00:00Z'),
  })
  console.log(`  ✓ O13 ${o13Trk}  Seun   DELIVERED_TO_RECIPIENT  batch:${closed3MTN}`)

  // ════════════════════════════════════════════════════════════
  // PHASE 7 — BATCH CUSTOMER SLOTS
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 7: Creating batch customer slots ──')

  // Open air batch: Seun (slot 1 = 20260620-0001), Tope (slot 2 = 20260620-0002)
  const openAirSeunSlot = slotTrk(openAirDate, 1)   // 20260620-0001
  const openAirTopeSlot = slotTrk(openAirDate, 2)   // 20260620-0002

  // Open sea batch: Amaka (slot 1 = 20260618-0001)
  const openSeaAmakaSlot = slotTrk(openSeaDate, 1)  // 20260618-0001

  // Closed batch 1: Amaka (slot 1 = 20260610-0001), Seun (slot 2 = 20260610-0002)
  const c1AmakaSlot = slotTrk(closed1Date, 1)
  const c1SeunSlot  = slotTrk(closed1Date, 2)

  // Closed batch 2: Tope (slot 1 = 20260601-0001), Amaka (slot 2 = 20260601-0002)
  const c2TopeSlot  = slotTrk(closed2Date, 1)
  const c2AmakaSlot = slotTrk(closed2Date, 2)

  // Closed batch 3: Seun (slot 1 = 20260525-0001)
  const c3SeunSlot  = slotTrk(closed3Date, 1)

  await sql`
    INSERT INTO batch_customer_slots (id, batch_id, customer_id, primary_tracking_number, created_at)
    VALUES
      (${randomUUID()}, ${openAirId},  ${seunId},  ${openAirSeunSlot},  ${openAirDate}),
      (${randomUUID()}, ${openAirId},  ${topeId},  ${openAirTopeSlot},  ${openAirDate}),
      (${randomUUID()}, ${openSeaId},  ${amakaId}, ${openSeaAmakaSlot}, ${openSeaDate}),
      (${randomUUID()}, ${closed1Id},  ${amakaId}, ${c1AmakaSlot},      ${closed1Date}),
      (${randomUUID()}, ${closed1Id},  ${seunId},  ${c1SeunSlot},       ${closed1Date}),
      (${randomUUID()}, ${closed2Id},  ${topeId},  ${c2TopeSlot},       ${closed2Date}),
      (${randomUUID()}, ${closed2Id},  ${amakaId}, ${c2AmakaSlot},      ${closed2Date}),
      (${randomUUID()}, ${closed3Id},  ${seunId},  ${c3SeunSlot},       ${closed3Date})
  `

  console.log(`  ✓ Open air:   Seun→${openAirSeunSlot}  Tope→${openAirTopeSlot}`)
  console.log(`  ✓ Open sea:   Amaka→${openSeaAmakaSlot}`)
  console.log(`  ✓ Closed #1:  Amaka→${c1AmakaSlot}  Seun→${c1SeunSlot}`)
  console.log(`  ✓ Closed #2:  Tope→${c2TopeSlot}  Amaka→${c2AmakaSlot}`)
  console.log(`  ✓ Closed #3:  Seun→${c3SeunSlot}`)

  // ════════════════════════════════════════════════════════════
  // PHASE 8 — ORDER STATUS EVENTS (history trail)
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 8: Creating status history ──')

  type StatusEvent = { orderId: string; status: string; at: Date }
  const events: StatusEvent[] = [
    // O1 Amaka arriving today
    { orderId: o1Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-28T09:15:00Z') },
    // O2 Seun arriving today
    { orderId: o2Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-28T11:30:00Z') },
    // O3 Tope received but not priced
    { orderId: o3Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-25T09:00:00Z') },
    { orderId: o3Id, status: 'WAREHOUSE_RECEIVED',         at: new Date('2026-06-25T14:00:00Z') },
    // O4 Seun on hold
    { orderId: o4Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-24T08:00:00Z') },
    { orderId: o4Id, status: 'WAREHOUSE_RECEIVED',         at: new Date('2026-06-24T09:00:00Z') },
    { orderId: o4Id, status: 'ON_HOLD',                    at: new Date('2026-06-24T10:00:00Z') },
    // O5 Amaka priced, no batch
    { orderId: o5Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-23T09:00:00Z') },
    { orderId: o5Id, status: 'WAREHOUSE_RECEIVED',         at: new Date('2026-06-23T11:00:00Z') },
    { orderId: o5Id, status: 'WAREHOUSE_VERIFIED_PRICED',  at: new Date('2026-06-23T12:00:00Z') },
    // O6 Seun in open air batch
    { orderId: o6Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-19T08:00:00Z') },
    { orderId: o6Id, status: 'WAREHOUSE_RECEIVED',         at: new Date('2026-06-19T09:30:00Z') },
    { orderId: o6Id, status: 'WAREHOUSE_VERIFIED_PRICED',  at: new Date('2026-06-19T10:00:00Z') },
    // O7 Tope in open air batch
    { orderId: o7Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-19T09:00:00Z') },
    { orderId: o7Id, status: 'WAREHOUSE_RECEIVED',         at: new Date('2026-06-19T10:00:00Z') },
    { orderId: o7Id, status: 'WAREHOUSE_VERIFIED_PRICED',  at: new Date('2026-06-19T10:30:00Z') },
    // O8 Amaka in open sea batch
    { orderId: o8Id, status: 'AWAITING_WAREHOUSE_RECEIPT', at: new Date('2026-06-17T09:00:00Z') },
    { orderId: o8Id, status: 'WAREHOUSE_RECEIVED',         at: new Date('2026-06-17T10:00:00Z') },
    { orderId: o8Id, status: 'WAREHOUSE_VERIFIED_PRICED',  at: new Date('2026-06-17T11:00:00Z') },
    // O9 Amaka flight departed
    { orderId: o9Id, status: 'AWAITING_WAREHOUSE_RECEIPT',    at: new Date('2026-06-08T14:00:00Z') },
    { orderId: o9Id, status: 'WAREHOUSE_RECEIVED',            at: new Date('2026-06-09T08:00:00Z') },
    { orderId: o9Id, status: 'WAREHOUSE_VERIFIED_PRICED',     at: new Date('2026-06-09T10:00:00Z') },
    { orderId: o9Id, status: 'DISPATCHED_TO_ORIGIN_AIRPORT',  at: new Date('2026-06-11T07:00:00Z') },
    { orderId: o9Id, status: 'AT_ORIGIN_AIRPORT',             at: new Date('2026-06-12T10:00:00Z') },
    { orderId: o9Id, status: 'BOARDED_ON_FLIGHT',             at: new Date('2026-06-12T14:00:00Z') },
    { orderId: o9Id, status: 'FLIGHT_DEPARTED',               at: new Date('2026-06-12T15:30:00Z') },
    // O10 Seun at origin airport
    { orderId: o10Id, status: 'AWAITING_WAREHOUSE_RECEIPT',   at: new Date('2026-06-08T15:00:00Z') },
    { orderId: o10Id, status: 'WAREHOUSE_RECEIVED',           at: new Date('2026-06-09T08:30:00Z') },
    { orderId: o10Id, status: 'WAREHOUSE_VERIFIED_PRICED',    at: new Date('2026-06-09T10:30:00Z') },
    { orderId: o10Id, status: 'DISPATCHED_TO_ORIGIN_AIRPORT', at: new Date('2026-06-11T07:00:00Z') },
    { orderId: o10Id, status: 'AT_ORIGIN_AIRPORT',            at: new Date('2026-06-12T10:00:00Z') },
    // O11 Tope customs cleared
    { orderId: o11Id, status: 'AWAITING_WAREHOUSE_RECEIPT',   at: new Date('2026-05-31T10:00:00Z') },
    { orderId: o11Id, status: 'WAREHOUSE_RECEIVED',           at: new Date('2026-06-01T08:00:00Z') },
    { orderId: o11Id, status: 'WAREHOUSE_VERIFIED_PRICED',    at: new Date('2026-06-01T09:00:00Z') },
    { orderId: o11Id, status: 'DISPATCHED_TO_ORIGIN_AIRPORT', at: new Date('2026-06-02T07:00:00Z') },
    { orderId: o11Id, status: 'AT_ORIGIN_AIRPORT',            at: new Date('2026-06-03T09:00:00Z') },
    { orderId: o11Id, status: 'BOARDED_ON_FLIGHT',            at: new Date('2026-06-03T13:00:00Z') },
    { orderId: o11Id, status: 'FLIGHT_DEPARTED',              at: new Date('2026-06-03T15:00:00Z') },
    { orderId: o11Id, status: 'FLIGHT_LANDED_LAGOS',          at: new Date('2026-06-04T22:00:00Z') },
    { orderId: o11Id, status: 'CUSTOMS_CLEARED_LAGOS',        at: new Date('2026-06-06T11:00:00Z') },
    // O12 Amaka ready for pickup (supplier-sourced)
    { orderId: o12Id, status: 'AWAITING_WAREHOUSE_RECEIPT',   at: new Date('2026-05-30T14:00:00Z') },
    { orderId: o12Id, status: 'WAREHOUSE_RECEIVED',           at: new Date('2026-06-01T08:30:00Z') },
    { orderId: o12Id, status: 'WAREHOUSE_VERIFIED_PRICED',    at: new Date('2026-06-01T09:30:00Z') },
    { orderId: o12Id, status: 'DISPATCHED_TO_ORIGIN_AIRPORT', at: new Date('2026-06-02T07:00:00Z') },
    { orderId: o12Id, status: 'AT_ORIGIN_AIRPORT',            at: new Date('2026-06-03T09:00:00Z') },
    { orderId: o12Id, status: 'BOARDED_ON_FLIGHT',            at: new Date('2026-06-03T13:00:00Z') },
    { orderId: o12Id, status: 'FLIGHT_DEPARTED',              at: new Date('2026-06-03T15:00:00Z') },
    { orderId: o12Id, status: 'FLIGHT_LANDED_LAGOS',          at: new Date('2026-06-04T22:00:00Z') },
    { orderId: o12Id, status: 'CUSTOMS_CLEARED_LAGOS',        at: new Date('2026-06-06T11:00:00Z') },
    { orderId: o12Id, status: 'IN_TRANSIT_TO_LAGOS_OFFICE',   at: new Date('2026-06-07T09:00:00Z') },
    { orderId: o12Id, status: 'READY_FOR_PICKUP',             at: new Date('2026-06-08T10:00:00Z') },
    // O13 Seun delivered
    { orderId: o13Id, status: 'AWAITING_WAREHOUSE_RECEIPT',   at: new Date('2026-05-23T09:00:00Z') },
    { orderId: o13Id, status: 'WAREHOUSE_RECEIVED',           at: new Date('2026-05-25T08:00:00Z') },
    { orderId: o13Id, status: 'WAREHOUSE_VERIFIED_PRICED',    at: new Date('2026-05-25T09:00:00Z') },
    { orderId: o13Id, status: 'DISPATCHED_TO_ORIGIN_AIRPORT', at: new Date('2026-05-26T07:00:00Z') },
    { orderId: o13Id, status: 'AT_ORIGIN_AIRPORT',            at: new Date('2026-05-27T09:00:00Z') },
    { orderId: o13Id, status: 'BOARDED_ON_FLIGHT',            at: new Date('2026-05-27T13:00:00Z') },
    { orderId: o13Id, status: 'FLIGHT_DEPARTED',              at: new Date('2026-05-27T15:00:00Z') },
    { orderId: o13Id, status: 'FLIGHT_LANDED_LAGOS',          at: new Date('2026-05-28T22:00:00Z') },
    { orderId: o13Id, status: 'CUSTOMS_CLEARED_LAGOS',        at: new Date('2026-05-30T11:00:00Z') },
    { orderId: o13Id, status: 'IN_TRANSIT_TO_LAGOS_OFFICE',   at: new Date('2026-05-31T09:00:00Z') },
    { orderId: o13Id, status: 'READY_FOR_PICKUP',             at: new Date('2026-06-01T10:00:00Z') },
    { orderId: o13Id, status: 'PICKED_UP_COMPLETED',          at: new Date('2026-06-02T14:00:00Z') },
    { orderId: o13Id, status: 'DELIVERED_TO_RECIPIENT',       at: new Date('2026-06-02T16:00:00Z') },
  ]

  // Insert in chunks of 20 to avoid oversized queries
  const chunkSize = 20
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize)
    for (const e of chunk) {
      await sql`
        INSERT INTO order_status_events (id, order_id, status, actor_id, created_at)
        VALUES (${randomUUID()}, ${e.orderId}, ${e.status}, ${deleId}, ${e.at})
      `
    }
  }

  console.log(`  ✓ ${events.length} status events inserted`)

  // ════════════════════════════════════════════════════════════
  // PHASE 9 — SUPPLIER DECLARATION (Flow 1 example)
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 9: Creating supplier declaration ──')

  const declId = randomUUID()
  await sql`
    INSERT INTO supplier_declarations (
      id, supplier_id,
      recipient_name, recipient_phone, recipient_email, recipient_address,
      description, quantity, declared_value_usd, estimated_weight_kg,
      shipment_type, status,
      order_id, linked_customer_id, linked_by,
      created_at, updated_at
    ) VALUES (
      ${declId}, ${kimId},
      'Amaka Okonkwo', '+2348031234567', 'amaka.okonkwo@gmail.com',
      '15 Adeola Odeku Street, Victoria Island, Lagos',
      'Apple AirPods Pro 2nd Gen and MagSafe charger (1 set)',
      1, '230.00', '1.50',
      'air', 'accepted',
      ${o12Id}, ${amakaId}, ${deleId},
      ${new Date('2026-05-29T10:00:00Z')}, ${now}
    )
  `

  console.log(`  ✓ Supplier declaration: Kim → Amaka (linked to O12, status: accepted)`)

  // ════════════════════════════════════════════════════════════
  // PHASE 10 — DORMANT LEDGER CLIENTS
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 10: Creating dormant ledger clients ──')

  // Remove any previous dormant stubs (no clerkId, role=user) before reinserting
  await sql`DELETE FROM users WHERE clerk_id IS NULL AND role = 'user' AND is_active = false`

  const LEDGER_CLIENTS = [
    { firstName: 'FESTUS',     lastName: null,          shippingMark: 'FESTUS',                phone: '07030500757' },
    { firstName: 'JOSHUA',     lastName: 'EMMANUEL',    shippingMark: 'JOSHUA EMMANUEL',       phone: null },
    { firstName: 'PRINCESS',   lastName: null,          shippingMark: 'Classy ChiDivine',      phone: '08075113522' },
    { firstName: 'JENNIFER',   lastName: 'NNAOBI',      shippingMark: 'Ossyjenny',             phone: '08037584818' },
    { firstName: 'FESTUS',     lastName: 'LOUIS',       shippingMark: 'FESTUS LOUIS',          phone: '09138109121' },
    { firstName: 'ZAYNAB',     lastName: 'ODUSOTE',     shippingMark: 'BeautyByDaz',           phone: '08034411151' },
    { firstName: 'TOSIN',      lastName: 'DADA',        shippingMark: 'RW-JEMMY',              phone: '07066760331' },
    { firstName: 'VICTOR',     lastName: null,          shippingMark: 'Premium Royalty',       phone: '08037617941' },
    { firstName: 'SPLENDID',   lastName: null,          shippingMark: 'The Bolden Co.',        phone: '+14698199369' },
    { firstName: 'CHINWE',     lastName: 'UDEH',        shippingMark: 'Xulcee Store',          phone: '08033138535' },
    { firstName: 'LILIAN',     lastName: 'UNACHUKWU',   shippingMark: 'Liam Mart',             phone: '08139544470' },
    { firstName: 'SYLVIMAK',   lastName: null,          shippingMark: 'SYLVIMAK',              phone: '07043296833' },
    { firstName: 'SOLOMON',    lastName: null,          shippingMark: 'ATEC',                  phone: '+12268082327' },
    { firstName: 'NNEOMA',     lastName: null,          shippingMark: 'LADIES CITY COSMETICS', phone: '08139416788' },
    { firstName: 'UCHUBUAGBO', lastName: 'OSELE',       shippingMark: 'Nature Guide',          phone: '07034832800' },
    { firstName: 'CHIKELUBA',  lastName: 'TAGBO',       shippingMark: 'Tbone Concepts',        phone: '08033456148' },
  ] as const

  for (const client of LEDGER_CLIENTS) {
    const clientId = randomUUID()
    await sql`
      INSERT INTO users
        (id, clerk_id, email, email_hash, first_name, last_name, phone, shipping_mark,
         role, is_active, created_at, updated_at)
      VALUES (
        ${clientId}, null, null, null,
        ${client.firstName ? enc(client.firstName) : null},
        ${client.lastName ? enc(client.lastName) : null},
        ${client.phone ? enc(client.phone) : null},
        ${enc(client.shippingMark)},
        'user', false,
        ${now}, ${now}
      )
    `
    console.log(`  ✓ ${client.shippingMark} (${client.firstName}${client.lastName ? ' ' + client.lastName : ''})`)
  }

  // ════════════════════════════════════════════════════════════
  // PHASE 11 — SUPPORT TICKETS
  // ════════════════════════════════════════════════════════════
  console.log('\n── Phase 11: Seeding support tickets ──')

  const t1Id = randomUUID()
  const t2Id = randomUUID()
  const t3Id = randomUUID()
  const t4Id = randomUUID()
  const t5Id = randomUUID()
  const t6Id = randomUUID()
  const t7Id = randomUUID()

  await sql`
    INSERT INTO support_tickets (id, ticket_number, user_id, category, status, subject, created_at, updated_at)
    VALUES
      (${t1Id}, 'TKT-62619001001', ${amakaId}, 'shipment_inquiry', 'open',
       'Where is my package? It has been 3 weeks', ${new Date('2026-06-01T09:00:00Z')}, ${new Date('2026-06-01T09:00:00Z')}),
      (${t2Id}, 'TKT-62619001002', ${seunId}, 'payment_issue', 'open',
       'I was charged twice for the same order', ${new Date('2026-06-05T14:30:00Z')}, ${new Date('2026-06-05T14:30:00Z')}),
      (${t3Id}, 'TKT-62619001003', ${topeId}, 'damaged_goods', 'open',
       'Shipment arrived with damaged items inside', ${new Date('2026-06-10T11:00:00Z')}, ${new Date('2026-06-10T11:00:00Z')}),
      (${t4Id}, 'TKT-62619001004', ${amakaId}, 'document_request', 'in_progress',
       'Need customs clearance document for my sea batch', ${new Date('2026-06-12T08:00:00Z')}, ${new Date('2026-06-15T10:00:00Z')}),
      (${t5Id}, 'TKT-62619001005', ${seunId}, 'general', 'in_progress',
       'How do I update my delivery address?', ${new Date('2026-06-18T16:00:00Z')}, ${new Date('2026-06-20T09:00:00Z')}),
      (${t6Id}, 'TKT-62619001006', ${topeId}, 'shipment_inquiry', 'resolved',
       'Tracking number not showing correct status', ${new Date('2026-06-08T12:00:00Z')}, ${new Date('2026-06-09T15:00:00Z')}),
      (${t7Id}, 'TKT-62619001007', ${amakaId}, 'account_issue', 'closed',
       'Cannot log in to my account', ${new Date('2026-05-20T10:00:00Z')}, ${new Date('2026-05-21T11:00:00Z')})
  `

  await sql`
    INSERT INTO support_messages (id, ticket_id, author_id, body, is_internal, created_at)
    VALUES
      (${randomUUID()}, ${t1Id}, ${amakaId},
       'Hi, I placed an order 3 weeks ago but the tracking shows no update. Can you check what happened?',
       false, ${new Date('2026-06-01T09:00:00Z')}),
      (${randomUUID()}, ${t2Id}, ${seunId},
       'I checked my bank statement and there are two charges of ₦15,000 on June 3rd for the same order. Please refund one.',
       false, ${new Date('2026-06-05T14:30:00Z')}),
      (${randomUUID()}, ${t3Id}, ${topeId},
       'When my package arrived the box was torn and one of the items was cracked. I have photos. How do I file a claim?',
       false, ${new Date('2026-06-10T11:00:00Z')}),
      (${randomUUID()}, ${t4Id}, ${amakaId},
       'I need the customs clearance certificate for my shipment in the current sea batch. My agent is asking for it.',
       false, ${new Date('2026-06-12T08:00:00Z')}),
      (${randomUUID()}, ${t4Id}, ${deleId},
       'Hello Amaka, we are currently processing your document request. It should be ready within 2 business days.',
       false, ${new Date('2026-06-15T10:00:00Z')}),
      (${randomUUID()}, ${t5Id}, ${seunId},
       'I want to change my delivery address for the upcoming batch. New address: 14 Opebi Road, Ikeja, Lagos.',
       false, ${new Date('2026-06-18T16:00:00Z')}),
      (${randomUUID()}, ${t6Id}, ${topeId},
       'My tracking page has been showing AT_ORIGIN_AIRPORT for 5 days. Is there a delay?',
       false, ${new Date('2026-06-08T12:00:00Z')}),
      (${randomUUID()}, ${t6Id}, ${deleId},
       'Hi Tope, there was a brief delay at the origin airport due to customs inspection. Your shipment departed yesterday and is now en route. Tracking will update within 24 hours.',
       false, ${new Date('2026-06-09T15:00:00Z')}),
      (${randomUUID()}, ${t7Id}, ${amakaId},
       'I cannot log in. I keep getting invalid password even though I have not changed it.',
       false, ${new Date('2026-05-20T10:00:00Z')}),
      (${randomUUID()}, ${t7Id}, ${deleId},
       'Hi Amaka, your account was locked due to too many failed login attempts. I have reset it — please try logging in again.',
       false, ${new Date('2026-05-21T11:00:00Z')})
  `

  await sql`UPDATE support_tickets SET closed_at = ${new Date('2026-05-21T12:00:00Z')} WHERE id = ${t7Id}`

  console.log('  ✓ 7 support tickets (3 open, 2 in_progress, 1 resolved, 1 closed)')
  console.log('  ✓ 10 support messages')

  // ════════════════════════════════════════════════════════════
  // DONE
  // ════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════')
  console.log('✅  Reseed complete!')
  console.log('\nSummary:')
  console.log('  Users:      3 active customers + 1 supplier + 16 dormant ledger clients')
  console.log('  Batches:    2 open (1 air, 1 sea) + 3 closed')
  console.log('  Orders:     13 across all pipeline stages')
  console.log('  Slots:      8 batch-customer slots')
  console.log('  Events:    ', events.length, 'status history events')
  console.log('  Support:    7 tickets (3 open, 2 in_progress, 1 resolved, 1 closed) + 10 messages')
  console.log('\nCustomer tracking numbers:')
  console.log(`  Seun  in ${openAirMTN}:  ${openAirSeunSlot}`)
  console.log(`  Tope  in ${openAirMTN}:  ${openAirTopeSlot}`)
  console.log(`  Amaka in ${openSeaMTN}: ${openSeaAmakaSlot}`)
  console.log(`  Amaka in ${closed1MTN}: ${c1AmakaSlot}  (FLIGHT_DEPARTED)`)
  console.log(`  Seun  in ${closed1MTN}: ${c1SeunSlot}  (AT_ORIGIN_AIRPORT)`)
  console.log(`  Tope  in ${closed2MTN}: ${c2TopeSlot}  (CUSTOMS_CLEARED_LAGOS)`)
  console.log(`  Amaka in ${closed2MTN}: ${c2AmakaSlot}  (READY_FOR_PICKUP)`)
  console.log(`  Seun  in ${closed3MTN}: ${c3SeunSlot}  (DELIVERED)`)
  console.log('═══════════════════════════════════════════\n')

  await sql.end()
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err)
  process.exit(1)
})
