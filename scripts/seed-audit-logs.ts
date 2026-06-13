import { config } from 'dotenv'
config({ path: '.env' })

import postgres from 'postgres'

// Active internal user IDs from production
const ACTORS = [
  { id: '962c0f26-c867-4afe-9680-db619814c013', role: 'superadmin' },
  { id: 'b9c97700-cc74-4b32-9fce-6bca82688b87', role: 'superadmin' },
  { id: '16416209-fe4b-462e-b2d5-fb5fb9015a10', role: 'superadmin' },
]

// Realistic audit log entries spread across the last 30 days
const ENTRIES = [
  { action: 'staff_login', resourceType: 'user', actorIdx: 0, daysAgo: 0, metadata: null },
  { action: 'staff_login', resourceType: 'user', actorIdx: 1, daysAgo: 0, metadata: null },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 1, daysAgo: 0, metadata: { from: 'WAREHOUSE_RECEIVED', to: 'WAREHOUSE_VERIFIED_PRICED' } },
  { action: 'payment_receipt_approved', resourceType: 'payment', actorIdx: 0, daysAgo: 1, metadata: { decision: 'approve', note: null } },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 0, daysAgo: 1, metadata: { from: 'DISPATCHED_TO_ORIGIN_AIRPORT', to: 'AT_ORIGIN_AIRPORT' } },
  { action: 'team_member_approved', resourceType: 'user', actorIdx: 0, daysAgo: 2, metadata: null },
  { action: 'payment_receipt_rejected', resourceType: 'payment', actorIdx: 1, daysAgo: 2, metadata: { decision: 'reject', note: 'Receipt image too blurry to verify' } },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 1, daysAgo: 3, metadata: { from: 'AT_ORIGIN_AIRPORT', to: 'BOARDED_ON_FLIGHT' } },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 0, daysAgo: 4, metadata: { from: 'BOARDED_ON_FLIGHT', to: 'FLIGHT_DEPARTED' } },
  { action: 'staff_login', resourceType: 'user', actorIdx: 2, daysAgo: 4, metadata: null },
  { action: 'payment_receipt_approved', resourceType: 'payment', actorIdx: 2, daysAgo: 5, metadata: { decision: 'approve', note: 'Verified against bank statement' } },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 1, daysAgo: 5, metadata: { from: 'FLIGHT_DEPARTED', to: 'FLIGHT_LANDED_LAGOS' } },
  { action: 'user_profile_updated', resourceType: 'user', actorIdx: 0, daysAgo: 6, metadata: null },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 2, daysAgo: 7, metadata: { from: 'FLIGHT_LANDED_LAGOS', to: 'CUSTOMS_CLEARED_LAGOS' } },
  { action: 'settings_updated', resourceType: 'app_settings', actorIdx: 0, daysAgo: 8, metadata: { key: 'require_national_id', value: true } },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 1, daysAgo: 9, metadata: { from: 'CUSTOMS_CLEARED_LAGOS', to: 'IN_TRANSIT_TO_LAGOS_OFFICE' } },
  { action: 'staff_login', resourceType: 'user', actorIdx: 0, daysAgo: 10, metadata: null },
  { action: 'payment_receipt_approved', resourceType: 'payment', actorIdx: 0, daysAgo: 10, metadata: { decision: 'approve', note: null } },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 0, daysAgo: 11, metadata: { from: 'IN_TRANSIT_TO_LAGOS_OFFICE', to: 'READY_FOR_PICKUP' } },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 1, daysAgo: 12, metadata: { from: 'READY_FOR_PICKUP', to: 'PICKED_UP_COMPLETED' } },
  { action: 'pricing_rule_updated', resourceType: 'pricing_rule', actorIdx: 0, daysAgo: 13, metadata: { type: 'air', change: 'rate adjustment' } },
  { action: 'payment_receipt_rejected', resourceType: 'payment', actorIdx: 2, daysAgo: 14, metadata: { decision: 'reject', note: 'Amount on receipt does not match order total' } },
  { action: 'staff_login', resourceType: 'user', actorIdx: 1, daysAgo: 15, metadata: null },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 2, daysAgo: 16, metadata: { from: 'WAREHOUSE_RECEIVED', to: 'WAREHOUSE_VERIFIED_PRICED' } },
  { action: 'team_member_approved', resourceType: 'user', actorIdx: 0, daysAgo: 18, metadata: null },
  { action: 'payment_receipt_approved', resourceType: 'payment', actorIdx: 1, daysAgo: 20, metadata: { decision: 'approve', note: null } },
  { action: 'settings_updated', resourceType: 'app_settings', actorIdx: 0, daysAgo: 22, metadata: { key: 'special_packaging', value: false } },
  { action: 'staff_login', resourceType: 'user', actorIdx: 0, daysAgo: 25, metadata: null },
  { action: 'order_status_updated', resourceType: 'order', actorIdx: 1, daysAgo: 28, metadata: { from: 'AWAITING_WAREHOUSE_RECEIPT', to: 'WAREHOUSE_RECEIVED' } },
  { action: 'staff_login', resourceType: 'user', actorIdx: 2, daysAgo: 30, metadata: null },
]

const SAMPLE_IPS = ['41.206.15.22', '102.89.34.11', '197.210.64.2', '196.46.20.5']
const SAMPLE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

async function main() {
  const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

  const now = new Date()

  for (const entry of ENTRIES) {
    const actor = ACTORS[entry.actorIdx]
    const createdAt = new Date(now.getTime() - entry.daysAgo * 24 * 60 * 60 * 1000)
    const ip = SAMPLE_IPS[entry.actorIdx % SAMPLE_IPS.length]

    await db`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at)
      VALUES (
        ${actor.id},
        ${entry.action},
        ${entry.resourceType},
        ${null},
        ${ip},
        ${SAMPLE_UA},
        ${entry.metadata ? JSON.stringify(entry.metadata) : null},
        ${createdAt.toISOString()}
      )
    `
  }

  console.log(`Inserted ${ENTRIES.length} audit log entries.`)
  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
