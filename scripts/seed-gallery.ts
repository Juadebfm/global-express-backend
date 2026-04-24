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

const GALLERY_ITEMS: GallerySeedItem[] = [
  {
    trackingNumber: `${TRACKING_PREFIX}AG-001`,
    itemType: GalleryItemType.ANONYMOUS_GOODS,
    title: 'Unclaimed iPhone + Accessories',
    description:
      'Packed at Lagos office from mixed parcel lot. Claimant should provide invoice or matching IMEI proof.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?package,warehouse,logistics&sig=101',
    mediaUrls: [
      'https://source.unsplash.com/1200x800/?parcel,shipment,box&sig=102',
      'https://source.unsplash.com/1200x800/?delivery,warehouse,package&sig=103',
    ],
    startsAtDaysAgo: 8,
    endsAtDaysFromNow: 30,
    metadata: {
      category: 'electronics',
      foundAt: 'Lagos warehouse',
      claimWindowDays: 30,
      condition: 'good',
    },
  },
  {
    trackingNumber: `${TRACKING_PREFIX}AG-002`,
    itemType: GalleryItemType.ANONYMOUS_GOODS,
    title: 'Unclaimed Laptop Bag + Documents',
    description:
      'Unclaimed package with office documents and laptop sleeve. Proof of ownership required before release.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?documents,package,desk&sig=104',
    mediaUrls: [
      'https://source.unsplash.com/1200x800/?paperwork,parcel,office&sig=105',
      'https://source.unsplash.com/1200x800/?box,storage,facility&sig=106',
    ],
    startsAtDaysAgo: 6,
    endsAtDaysFromNow: 28,
    metadata: {
      category: 'documents',
      foundAt: 'Abuja transit hub',
      claimWindowDays: 28,
      condition: 'sealed',
    },
  },
  {
    trackingNumber: `${TRACKING_PREFIX}AG-003`,
    itemType: GalleryItemType.ANONYMOUS_GOODS,
    title: 'Unclaimed Baby Care Box',
    description:
      'Carton includes infant clothing and care supplies. Owner should submit a matching shipment receipt.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?baby,package,delivery&sig=107',
    mediaUrls: [
      'https://source.unsplash.com/1200x800/?infant,parcel,box&sig=108',
      'https://source.unsplash.com/1200x800/?family,shipment,goods&sig=109',
    ],
    startsAtDaysAgo: 5,
    endsAtDaysFromNow: 25,
    metadata: {
      category: 'personal_items',
      foundAt: 'Lagos sorting desk',
      claimWindowDays: 25,
      condition: 'excellent',
    },
  },
  {
    trackingNumber: `${TRACKING_PREFIX}AG-004`,
    itemType: GalleryItemType.ANONYMOUS_GOODS,
    title: 'Unclaimed Kitchen Appliances Bundle',
    description:
      'Two compact appliances in a single parcel. Claim requires photo proof and recipient contact details.',
    previewImageUrl: 'https://source.unsplash.com/1200x800/?kitchen,appliance,box&sig=110',
    mediaUrls: [
      'https://source.unsplash.com/1200x800/?home,appliance,delivery&sig=111',
      'https://source.unsplash.com/1200x800/?warehouse,carton,inventory&sig=112',
    ],
    startsAtDaysAgo: 3,
    endsAtDaysFromNow: 21,
    metadata: {
      category: 'home_appliances',
      foundAt: 'Ikeja warehouse shelf B3',
      claimWindowDays: 21,
      condition: 'new',
    },
  },
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
    ctaUrl: 'https://zikel-solutions.vercel.app/services/air-freight',
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
    ctaUrl: 'https://zikel-solutions.vercel.app/services/d2d',
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
    ctaUrl: 'https://zikel-solutions.vercel.app/contact',
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
      GALLERY_ITEMS.map((item, idx) => ({
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
