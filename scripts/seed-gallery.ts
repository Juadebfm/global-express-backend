/**
 * Seed script — inserts temporary public gallery demo records for FE UX design.
 *
 * Usage:
 *   npm run seed:gallery
 *
 * Safe to re-run:
 *   - Deletes previous rows created by this script (via tracking prefix)
 *   - Re-inserts a fresh set of anonymous goods, cars, and adverts
 *
 * Cleanup later:
 *   npm run seed:gallery:cleanup
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { and, eq, isNull, like } from 'drizzle-orm'
import { db } from '../src/config/db'
import { galleryItems, users } from '../drizzle/schema'
import { GalleryItemStatus, GalleryItemType, UserRole } from '../src/types/enums'

const TRACKING_PREFIX = 'SEED-GALLERY-V1-'

type GallerySeedItem = {
  trackingNumber: string
  itemType: GalleryItemType
  title: string
  description: string
  previewImageUrl: string
  mediaUrls: string[]
  ctaUrl?: string
  startsAtDaysAgo: number | null
  endsAtDaysFromNow: number | null
  carPriceNgn?: string
  metadata?: Record<string, unknown>
}

function daysAgo(days: number): Date {
  const value = new Date()
  value.setDate(value.getDate() - days)
  return value
}

function daysFromNow(days: number): Date {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return value
}

const ANONYMOUS_SHIPMENT_TYPES = [
  'air',
  'air',
  'air',
  'air',
  'air',
  'air',
  'air',
  'air',
  'ocean',
  'ocean',
  'ocean',
  'ocean',
  'ocean',
  'ocean',
  'ocean',
  'ocean',
  'd2d',
  'd2d',
  'd2d',
  'd2d',
  'd2d',
  'd2d',
  'd2d',
  'd2d',
] as const

const ANONYMOUS_GOODS_LABELS = [
  'Mobile Accessories Carton',
  'Clothing Bundle Parcel',
  'Kitchen Essentials Package',
  'Beauty Products Mix Box',
  'Office Gadgets Pouch',
  'Books and Study Materials',
  'Footwear Carton',
  'Small Electronics Bundle',
  'Home Decor Carton',
  'Fitness Accessories Parcel',
  'Auto Parts Lite Package',
  'Toy Set Bundle',
  'Laptop Peripherals Box',
  'Camera Gear Parcel',
  'Medical Supplies Carton',
  'Household Utility Pack',
  'D2D Family Goods Bundle',
  'D2D Business Samples Box',
  'D2D Textile Parcel',
  'D2D Food-safe Containers',
  'D2D Personal Effects',
  'D2D Beauty Retail Stock',
  'D2D Stationery Carton',
  'D2D Mixed Consumer Goods',
]

function buildAnonymousGoodsItems(supplierIds: string[]): GallerySeedItem[] {
  const fallbackSupplierHints = [
    '00000000-0000-0000-0000-00000000A111',
    '00000000-0000-0000-0000-00000000B222',
  ]
  const supplierHints = supplierIds.length > 0 ? supplierIds : fallbackSupplierHints
  const receivedDaysAgo = [
    7, 12, 16, 22, 28, 34, 42, 56,
    18, 27, 36, 45, 59, 73, 88, 110,
    10, 21, 33, 47, 61, 79, 102, 135,
  ]

  return ANONYMOUS_SHIPMENT_TYPES.map((shipmentType, idx) => {
    const modeCode = shipmentType === 'air' ? 'AIR' : shipmentType === 'ocean' ? 'OCN' : 'D2D'
    const seq = String(idx + 1).padStart(3, '0')
    const length = 28 + (idx % 6) * 5
    const width = 20 + (idx % 5) * 4
    const height = 16 + (idx % 4) * 3
    const cbm = Number(((length * width * height) / 1_000_000).toFixed(6))
    const weightBase = shipmentType === 'ocean' ? 1.2 : shipmentType === 'd2d' ? 0.9 : 0.6
    const weightKg = Number((weightBase + (idx % 7) * 0.22).toFixed(3))
    const qty = 1 + (idx % 3)
    const supplierId = idx % 3 === 0 ? supplierHints[idx % supplierHints.length] : null
    const label = ANONYMOUS_GOODS_LABELS[idx]
    const warehouseReceivedAt = daysAgo(receivedDaysAgo[idx]).toISOString()

    return {
      trackingNumber: `${TRACKING_PREFIX}AG-${modeCode}-${seq}`,
      itemType: GalleryItemType.ANONYMOUS_GOODS,
      title: `Unclaimed ${label}`,
      description:
        `Unclaimed warehouse goods (${shipmentType.toUpperCase()}) pending rightful ownership verification.`,
      previewImageUrl: `https://source.unsplash.com/1200x800/?package,warehouse,${shipmentType}&sig=${200 + idx * 3}`,
      mediaUrls: [
        `https://source.unsplash.com/1200x800/?parcel,logistics,${shipmentType}&sig=${201 + idx * 3}`,
        `https://source.unsplash.com/1200x800/?shipment,box,${shipmentType}&sig=${202 + idx * 3}`,
      ],
      startsAtDaysAgo: Math.max(receivedDaysAgo[idx] - 2, 1),
      endsAtDaysFromNow: 180,
      metadata: {
        shipmentType,
        description: `Claim intake for ${label}`,
        itemType: 'anonymous_goods',
        quantity: qty,
        dimensionsCm: { length, width, height },
        weightKg,
        cbm,
        warehouseReceivedAt,
        supplierId,
        origin: 'South Korea',
        destination: 'Lagos, Nigeria',
        warehouseStatus: 'WAREHOUSE_RECEIVED',
      },
    }
  })
}

const MARKET_ITEMS: GallerySeedItem[] = [
  {
    trackingNumber: `${TRACKING_PREFIX}CAR-001`,
    itemType: GalleryItemType.CAR,
    title: '2018 Toyota Camry LE',
    description:
      'Tokunbo unit available for first-come reservation. Inspection report and VIN available upon request.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?toyota,car,showroom&sig=113',
    mediaUrls: [
      'https://source.unsplash.com/1200x800/?sedan,automobile,interior&sig=114',
      'https://source.unsplash.com/1200x800/?car,dealership,vehicle&sig=115',
    ],
    startsAtDaysAgo: 10,
    endsAtDaysFromNow: 40,
    carPriceNgn: '18500000',
    metadata: {
      year: 2018,
      mileageKm: 68200,
      fuelType: 'petrol',
      transmission: 'automatic',
      location: 'Lagos',
    },
  },
  {
    trackingNumber: `${TRACKING_PREFIX}CAR-002`,
    itemType: GalleryItemType.CAR,
    title: '2017 Lexus RX 350',
    description:
      'Imported crossover with clean interior and reverse camera. Reserve now and complete verification with support.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?lexus,suv,car&sig=116',
    mediaUrls: [
      'https://source.unsplash.com/1200x800/?luxury,vehicle,suv&sig=117',
      'https://source.unsplash.com/1200x800/?automobile,exterior,car&sig=118',
    ],
    startsAtDaysAgo: 9,
    endsAtDaysFromNow: 35,
    carPriceNgn: '29800000',
    metadata: {
      year: 2017,
      mileageKm: 74300,
      fuelType: 'petrol',
      transmission: 'automatic',
      location: 'Abuja',
    },
  },
  {
    trackingNumber: `${TRACKING_PREFIX}AD-001`,
    itemType: GalleryItemType.ADVERT,
    title: 'Need Fast Air Freight from Korea?',
    description:
      'Book priority cargo lanes for urgent parcels with predictable weekly departures to Lagos.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?air,cargo,logistics&sig=119',
    mediaUrls: ['https://source.unsplash.com/1200x800/?freight,airplane,cargo&sig=120'],
    ctaUrl: 'https://global-express.vercel.app/services/air-freight',
    startsAtDaysAgo: 2,
    endsAtDaysFromNow: 60,
    metadata: {
      placement: 'public_gallery',
      badge: 'Priority',
      campaign: 'air_freight_q2',
    },
  },
  {
    trackingNumber: `${TRACKING_PREFIX}AD-002`,
    itemType: GalleryItemType.ADVERT,
    title: 'Door-to-Door Shipping Promo',
    description:
      'Enjoy reduced handling fees this month on qualified door-to-door shipments into major Nigerian cities.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?delivery,truck,logistics&sig=121',
    mediaUrls: ['https://source.unsplash.com/1200x800/?shipping,courier,route&sig=122'],
    ctaUrl: 'https://global-express.vercel.app/services/d2d',
    startsAtDaysAgo: 1,
    endsAtDaysFromNow: 45,
    metadata: {
      placement: 'public_gallery',
      badge: 'Promo',
      campaign: 'd2d_discount_april',
    },
  },
  {
    trackingNumber: `${TRACKING_PREFIX}AD-003`,
    itemType: GalleryItemType.ADVERT,
    title: 'Weekly Clearing & Pickup Support',
    description:
      'Our Lagos operations team can handle customs and same-week pickup coordination for businesses.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?customs,warehouse,operations&sig=123',
    mediaUrls: ['https://source.unsplash.com/1200x800/?office,logistics,support&sig=124'],
    ctaUrl: 'https://global-express.vercel.app/contact',
    startsAtDaysAgo: 4,
    endsAtDaysFromNow: 50,
    metadata: {
      placement: 'public_gallery',
      badge: 'Service',
      campaign: 'clearing_support_q2',
    },
  },
]

async function main() {
  console.log('\n🌱  Seeding temporary public gallery demo data...\n')

  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, UserRole.SUPER_ADMIN), isNull(users.deletedAt)))
    .limit(1)

  if (!superAdmin) {
    console.error('\n❌  No superadmin found. Run "npm run seed:superadmin" first.\n')
    process.exit(1)
  }

  const supplierRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, UserRole.SUPPLIER), isNull(users.deletedAt)))
    .limit(5)

  const galleryItemsToSeed = [
    ...buildAnonymousGoodsItems(supplierRows.map((row) => row.id)),
    ...MARKET_ITEMS,
  ]

  const deleted = await db
    .delete(galleryItems)
    .where(like(galleryItems.trackingNumber, `${TRACKING_PREFIX}%`))
    .returning({ id: galleryItems.id })

  if (deleted.length > 0) {
    console.log(`  🧹  Removed ${deleted.length} previous gallery seed rows`)
  }

  const now = new Date()
  const seededRows = await db
    .insert(galleryItems)
    .values(
      galleryItemsToSeed.map((item, idx) => ({
        trackingNumber: item.trackingNumber,
        itemType: item.itemType,
        status: GalleryItemStatus.PUBLISHED,
        title: item.title,
        description: item.description,
        previewImageUrl: item.previewImageUrl,
        mediaUrls: item.mediaUrls,
        ctaUrl: item.ctaUrl ?? null,
        startsAt: item.startsAtDaysAgo == null ? null : daysAgo(item.startsAtDaysAgo),
        endsAt: item.endsAtDaysFromNow == null ? null : daysFromNow(item.endsAtDaysFromNow),
        isPublished: true,
        carPriceNgn: item.itemType === GalleryItemType.CAR ? item.carPriceNgn ?? null : null,
        priceCurrency: 'NGN',
        metadata: {
          ...(item.metadata ?? {}),
          seededBy: 'scripts/seed-gallery.ts',
          seedVersion: 'v1',
        },
        createdBy: superAdmin.id,
        updatedBy: superAdmin.id,
        createdAt: new Date(now.getTime() - idx * 60_000),
        updatedAt: new Date(now.getTime() - idx * 60_000),
      })),
    )
    .returning({ id: galleryItems.id, itemType: galleryItems.itemType })

  const countByType = seededRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.itemType] = (acc[row.itemType] ?? 0) + 1
    return acc
  }, {})

  console.log(`  ✅  Gallery rows inserted: ${seededRows.length}`)
  console.log(`      • anonymous_goods: ${countByType[GalleryItemType.ANONYMOUS_GOODS] ?? 0}`)
  console.log(`      • car: ${countByType[GalleryItemType.CAR] ?? 0}`)
  console.log(`      • advert: ${countByType[GalleryItemType.ADVERT] ?? 0}`)
  console.log('\n✅  Gallery seed complete.\n')
  console.log('    Public endpoints to verify:')
  console.log('      • GET /api/v1/public/gallery')
  console.log('      • GET /api/v1/public/gallery/adverts')
  console.log('\n    Remove later with: npm run seed:gallery:cleanup\n')

  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌  Gallery seed failed:', err)
  process.exit(1)
})
