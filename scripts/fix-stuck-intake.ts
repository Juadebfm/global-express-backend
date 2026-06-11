import { config } from 'dotenv'
config({ path: '.env' })

import { db } from '../src/config/db'
import { orders, orderPackages } from '../drizzle/schema'
import { eq, sql } from 'drizzle-orm'
import { pricingV2Service } from '../src/services/pricing-v2.service'
import { ShipmentPayer, ShipmentStatusV2, TransportMode } from '../src/types/enums'

const SEA_CBM_TO_KG_FACTOR = 1000

function toNumber(v: string | null | undefined): number {
  const n = parseFloat(v ?? '0')
  return isNaN(n) ? 0 : n
}

async function main() {
  const TRACKING = 'GEX-CUST-20260611-D7BE5C'

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.trackingNumber, TRACKING))
    .limit(1)

  if (!order) {
    console.error('Order not found:', TRACKING)
    process.exit(1)
  }

  console.log('Found order:', order.id)
  console.log('Status:', order.statusV2)
  console.log('Mode:', order.transportMode)

  const packages = await db
    .select({ weightKg: orderPackages.weightKg, cbm: orderPackages.cbm })
    .from(orderPackages)
    .where(eq(orderPackages.orderId, order.id))

  const totalCbm = packages.reduce((sum, p) => sum + toNumber(p.cbm), 0)
  const totalWeight = packages.reduce((sum, p) => sum + toNumber(p.weightKg), 0)

  const seaChargeableWeightKg = totalCbm * SEA_CBM_TO_KG_FACTOR
  const airChargeableWeightKg = packages.reduce((sum, p) => {
    const w = toNumber(p.weightKg)
    const vol = toNumber(p.cbm) > 0 ? (toNumber(p.cbm) * 1_000_000) / 6000 : 0
    return sum + Math.max(w, vol)
  }, 0)

  const rateOwnerId =
    order.shipmentPayer === ShipmentPayer.SUPPLIER
      ? order.billingSupplierId!
      : order.senderId

  const weightKg =
    order.transportMode === TransportMode.AIR
      ? (airChargeableWeightKg > 0 ? airChargeableWeightKg : totalWeight)
      : seaChargeableWeightKg

  const pricing = await pricingV2Service.calculatePricing({
    customerId: rateOwnerId,
    mode: order.transportMode as TransportMode,
    weightKg,
    cbm: order.transportMode === TransportMode.SEA ? totalCbm : undefined,
  })

  console.log('Calculated price:', pricing.amountUsd, 'USD, source:', pricing.pricingSource)

  await db
    .update(orders)
    .set({
      statusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
      customerStatusV2: ShipmentStatusV2.WAREHOUSE_VERIFIED_PRICED,
      calculatedChargeUsd: pricing.amountUsd.toString(),
      finalChargeUsd: pricing.amountUsd.toString(),
      pricingSource: pricing.pricingSource,
      priceCalculatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))

  console.log('✅ Fixed! Status updated to WAREHOUSE_VERIFIED_PRICED')
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
