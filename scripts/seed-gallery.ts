/**
 * Seed script — inserts temporary public gallery demo records for FE UX design.
 *
 * Usage:
 *   npm run seed:gallery
 *
 * Safe to re-run:
 *   - Deletes previous rows created by this script (via metadata marker)
 *   - Re-inserts a fresh set of anonymous goods, cars, and adverts
 *
 * Cleanup later:
 *   npm run seed:gallery:cleanup
 */

import { config } from 'dotenv'
config({ path: '.env' })

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../src/config/db'
import {
  galleryItems,
  shopInterestRequests,
  shopItemDetails,
  shopListings,
  shopVehicleDetails,
  users,
} from '../drizzle/schema'
import { GalleryItemStatus, GalleryItemType, UserRole } from '../src/types/enums'
import { generateTrackingNumber } from '../src/utils/tracking'
import { PUBLIC_SHOP_ASSET_KEYS, getPublicShopAssetUrl } from '../src/utils/public-shop-assets'

const SEED_SOURCE = 'scripts/seed-gallery.ts'
const SHARED_ANONYMOUS_GOODS_IMAGE = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#fff4ec"/>
        <stop offset="100%" stop-color="#ffe0cc"/>
      </linearGradient>
      <linearGradient id="box" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#f4b26c"/>
        <stop offset="100%" stop-color="#d9863d"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="800" rx="36" fill="url(#bg)"/>
    <rect x="90" y="95" width="1020" height="610" rx="28" fill="#ffffff" opacity="0.72"/>
    <rect x="145" y="160" width="330" height="420" rx="28" fill="#ff6a13" opacity="0.12"/>
    <rect x="770" y="130" width="270" height="470" rx="28" fill="#ff6a13" opacity="0.18"/>
    <path d="M462 290l165-102 193 111v220L655 620 462 510z" fill="url(#box)" stroke="#9f5d22" stroke-width="8"/>
    <path d="M627 188v329" stroke="#9f5d22" stroke-width="8"/>
    <path d="M462 290l194 107 164-98" fill="none" stroke="#9f5d22" stroke-width="8"/>
    <rect x="584" y="260" width="84" height="22" rx="11" fill="#fff2e2" opacity="0.9"/>
    <text x="130" y="680" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#1f2937">Global Express warehouse item</text>
    <text x="130" y="732" font-family="Arial, sans-serif" font-size="30" fill="#4b5563">Shared preview for anonymous-goods rows</text>
  </svg>`,
)}`

type GallerySeedItem = {
  itemType: GalleryItemType
  title: string
  description: string
  previewImageUrl: string
  mediaUrls: string[]
  ctaUrl?: string
  startsAtDaysAgo: number | null
  endsAtDaysFromNow: number | null
  carPriceNgn?: string
  priceUsd?: string
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
      trackingNumber: `${modeCode}-${seq}`,
      itemType: GalleryItemType.ANONYMOUS_GOODS,
      title: `Unclaimed ${label}`,
      description:
        `Unclaimed warehouse goods (${shipmentType.toUpperCase()}) pending rightful ownership verification.`,
      previewImageUrl: SHARED_ANONYMOUS_GOODS_IMAGE,
      mediaUrls: [SHARED_ANONYMOUS_GOODS_IMAGE],
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
    itemType: GalleryItemType.CAR,
    title: '2018 Toyota Camry LE',
    description:
      'Tokunbo unit available for first-come reservation. Inspection report and VIN available upon request.',
    previewImageUrl: getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.CAR_SEDAN),
    mediaUrls: [getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.CAR_SEDAN)],
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
    itemType: GalleryItemType.CAR,
    title: '2017 Lexus RX 350',
    description:
      'Imported crossover with clean interior and reverse camera. Reserve now and complete verification with support.',
    previewImageUrl: getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.CAR_SUV),
    mediaUrls: [getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.CAR_SUV)],
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
    itemType: GalleryItemType.FOR_SALE,
    title: 'Sony WH-1000XM5 Headphones',
    description:
      'Factory-sealed premium noise-cancelling headphones available from warehouse stock.',
    previewImageUrl: getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.SALE_ITEM),
    mediaUrls: [getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.SALE_ITEM)],
    startsAtDaysAgo: 6,
    endsAtDaysFromNow: 45,
    priceUsd: '340.00',
    metadata: {
      category: 'electronics',
      quantity: 4,
      condition: 'new',
      sku: 'SONY-WH1000XM5',
      location: 'Lagos',
    },
  },
  {
    itemType: GalleryItemType.FOR_SALE,
    title: 'KitchenAid Stand Mixer',
    description:
      'Warehouse-ready countertop mixer for immediate staff-assisted purchase inquiry.',
    previewImageUrl: getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.SALE_ITEM),
    mediaUrls: [getPublicShopAssetUrl(PUBLIC_SHOP_ASSET_KEYS.SALE_ITEM)],
    startsAtDaysAgo: 4,
    endsAtDaysFromNow: 30,
    priceUsd: '525.00',
    metadata: {
      category: 'home_appliance',
      quantity: 2,
      condition: 'open_box',
      sku: 'KITCHENAID-MIXER',
      location: 'Lagos',
    },
  },
  {
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
    ...MARKET_ITEMS.filter((item) => item.itemType === GalleryItemType.ADVERT),
  ]
  const shopItemsToSeed = MARKET_ITEMS.filter(
    (item) =>
      item.itemType === GalleryItemType.CAR || item.itemType === GalleryItemType.FOR_SALE,
  )

  const seededShopRows = await db
    .select({ id: shopListings.id })
    .from(shopListings)
    .where(sql`coalesce(${shopListings.metadata} ->> 'seededBy', '') = ${SEED_SOURCE}`)

  if (seededShopRows.length > 0) {
    const seededShopIds = seededShopRows.map((row) => row.id)
    await db
      .delete(shopInterestRequests)
      .where(inArray(shopInterestRequests.listingId, seededShopIds))
    await db.delete(shopListings).where(inArray(shopListings.id, seededShopIds))
  }

  const deleted = await db
    .delete(galleryItems)
    .where(sql`coalesce(${galleryItems.metadata} ->> 'seededBy', '') = ${SEED_SOURCE}`)
    .returning({ id: galleryItems.id })

  if (deleted.length > 0) {
    console.log(`  🧹  Removed ${deleted.length} previous gallery seed rows`)
  }

  const now = new Date()
  const galleryValues = await Promise.all(
    galleryItemsToSeed.map(async (item, idx) => {
      const createdAt = new Date(now.getTime() - idx * 60_000)

      return {
        trackingNumber: await generateTrackingNumber(undefined, createdAt),
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
          seededBy: SEED_SOURCE,
          seedVersion: 'v4',
        },
        createdBy: superAdmin.id,
        updatedBy: superAdmin.id,
        createdAt,
        updatedAt: createdAt,
      }
    }),
  )

  const seededRows = await db
    .insert(galleryItems)
    .values(galleryValues)
    .returning({ id: galleryItems.id, itemType: galleryItems.itemType })

  const insertedShopRows: Array<{ id: string; itemType: GalleryItemType }> = []

  for (const [idx, item] of shopItemsToSeed.entries()) {
    const createdAt = new Date(now.getTime() - (galleryItemsToSeed.length + idx) * 60_000)
    const [listing] = await db
      .insert(shopListings)
      .values({
        trackingNumber: await generateTrackingNumber(undefined, createdAt),
        listingKind: item.itemType === GalleryItemType.CAR ? 'vehicle' : 'general_item',
        status: 'published',
        title: item.title,
        description: item.description,
        previewImageUrl: item.previewImageUrl,
        mediaUrls: item.mediaUrls,
        startsAt: item.startsAtDaysAgo == null ? null : daysAgo(item.startsAtDaysAgo),
        endsAt: item.endsAtDaysFromNow == null ? null : daysFromNow(item.endsAtDaysFromNow),
        priceAmount: item.itemType === GalleryItemType.CAR ? item.carPriceNgn ?? null : item.priceUsd ?? null,
        priceCurrency: item.itemType === GalleryItemType.CAR ? 'NGN' : 'USD',
        isPricePublic: true,
        metadata: {
          ...(item.metadata ?? {}),
          seededBy: SEED_SOURCE,
          seedVersion: 'v4',
        },
        publishedAt: createdAt,
        archivedAt: null,
        createdBy: superAdmin.id,
        updatedBy: superAdmin.id,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: shopListings.id })

    if (!listing) continue

    if (item.itemType === GalleryItemType.CAR) {
      await db.insert(shopVehicleDetails).values({
        listingId: listing.id,
        year: typeof item.metadata?.year === 'number' ? item.metadata.year : null,
        mileageKm:
          typeof item.metadata?.mileageKm === 'number' ? item.metadata.mileageKm : null,
        fuelType: typeof item.metadata?.fuelType === 'string' ? item.metadata.fuelType : null,
        transmission:
          typeof item.metadata?.transmission === 'string' ? item.metadata.transmission : null,
        location: typeof item.metadata?.location === 'string' ? item.metadata.location : null,
        metadata: item.metadata ?? null,
        createdAt,
        updatedAt: createdAt,
      })
    } else {
      await db.insert(shopItemDetails).values({
        listingId: listing.id,
        category: typeof item.metadata?.category === 'string' ? item.metadata.category : null,
        quantity: typeof item.metadata?.quantity === 'number' ? item.metadata.quantity : null,
        condition: typeof item.metadata?.condition === 'string' ? item.metadata.condition : null,
        sku: typeof item.metadata?.sku === 'string' ? item.metadata.sku : null,
        location: typeof item.metadata?.location === 'string' ? item.metadata.location : null,
        metadata: item.metadata ?? null,
        createdAt,
        updatedAt: createdAt,
      })
    }

    insertedShopRows.push({ id: listing.id, itemType: item.itemType })
  }

  const countByType = seededRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.itemType] = (acc[row.itemType] ?? 0) + 1
    return acc
  }, {})

  console.log(`  ✅  Gallery rows inserted: ${seededRows.length}`)
  console.log(`      • anonymous_goods: ${countByType[GalleryItemType.ANONYMOUS_GOODS] ?? 0}`)
  console.log(`      • advert: ${countByType[GalleryItemType.ADVERT] ?? 0}`)
  console.log(`  ✅  Shop rows inserted: ${insertedShopRows.length}`)
  console.log(
    `      • car: ${insertedShopRows.filter((row) => row.itemType === GalleryItemType.CAR).length}`,
  )
  console.log(
    `      • for_sale: ${insertedShopRows.filter((row) => row.itemType === GalleryItemType.FOR_SALE).length}`,
  )
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
