import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { galleryItems } from './gallery'
import { inboundLeads } from './inbound-leads'
import { supportTickets } from './support-tickets'
import { users } from './users'

export const shopListingKindEnum = pgEnum('shop_listing_kind', ['vehicle', 'general_item'])

export const shopListingStatusEnum = pgEnum('shop_listing_status', [
  'draft',
  'published',
  'unpublished',
  'archived',
  'sold',
])

export const shopInterestSourceEnum = pgEnum('shop_interest_source', [
  'public',
  'authenticated',
  'staff',
])

export const shopInterestStatusEnum = pgEnum('shop_interest_status', [
  'new',
  'contacted',
  'qualified',
  'hold_offered',
  'converted',
  'closed',
])

export const shopHoldStatusEnum = pgEnum('shop_hold_status', [
  'active',
  'expired',
  'released',
  'converted',
])

export const shopListings = pgTable(
  'shop_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingNumber: text('tracking_number').notNull(),
    listingKind: shopListingKindEnum('listing_kind').notNull(),
    status: shopListingStatusEnum('status').notNull().default('draft'),
    title: text('title').notNull(),
    description: text('description'),
    previewImageUrl: text('preview_image_url'),
    mediaUrls: jsonb('media_urls').$type<string[]>().notNull().default([]),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    priceAmount: numeric('price_amount', { precision: 14, scale: 2 }),
    priceCurrency: text('price_currency').notNull(),
    isPricePublic: boolean('is_price_public').notNull().default(true),
    sourceGalleryItemId: uuid('source_gallery_item_id').references(() => galleryItems.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shop_listings_tracking_number_unique_idx').on(table.trackingNumber),
    uniqueIndex('shop_listings_source_gallery_item_id_unique_idx')
      .on(table.sourceGalleryItemId)
      .where(sql`${table.sourceGalleryItemId} is not null`),
    index('shop_listings_status_listing_kind_published_at_idx').on(
      table.status,
      table.listingKind,
      table.publishedAt,
    ),
    index('shop_listings_created_at_idx').on(table.createdAt),
    check(
      'shop_listings_tracking_number_format_check',
      sql`${table.trackingNumber} ~ '^[0-9]{8}-[0-9]{4}$'`,
    ),
    check(
      'shop_listings_price_amount_non_negative_check',
      sql`${table.priceAmount} is null or ${table.priceAmount} >= 0`,
    ),
    check(
      'shop_listings_visibility_window_check',
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} >= ${table.startsAt}`,
    ),
  ],
)

export const shopVehicleDetails = pgTable('shop_vehicle_details', {
  listingId: uuid('listing_id')
    .primaryKey()
    .references(() => shopListings.id, { onDelete: 'cascade' }),
  make: text('make'),
  model: text('model'),
  year: integer('year'),
  mileageKm: integer('mileage_km'),
  fuelType: text('fuel_type'),
  transmission: text('transmission'),
  location: text('location'),
  vin: text('vin'),
  exteriorColor: text('exterior_color'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const shopItemDetails = pgTable('shop_item_details', {
  listingId: uuid('listing_id')
    .primaryKey()
    .references(() => shopListings.id, { onDelete: 'cascade' }),
  category: text('category'),
  quantity: integer('quantity'),
  condition: text('condition'),
  sku: text('sku'),
  location: text('location'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const shopInterestRequests = pgTable(
  'shop_interest_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id').notNull().references(() => shopListings.id),
    source: shopInterestSourceEnum('source').notNull(),
    status: shopInterestStatusEnum('status').notNull().default('new'),
    sourceInboundLeadId: uuid('source_inbound_lead_id').references(() => inboundLeads.id, {
      onDelete: 'set null',
    }),
    requesterUserId: uuid('requester_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    supportTicketId: uuid('support_ticket_id').references(() => supportTickets.id, {
      onDelete: 'set null',
    }),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    message: text('message'),
    staffNotes: text('staff_notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shop_interest_requests_source_inbound_lead_id_unique_idx')
      .on(table.sourceInboundLeadId)
      .where(sql`${table.sourceInboundLeadId} is not null`),
    index('shop_interest_requests_listing_id_created_at_idx').on(table.listingId, table.createdAt),
    index('shop_interest_requests_status_created_at_idx').on(table.status, table.createdAt),
    index('shop_interest_requests_assigned_to_idx').on(table.assignedTo),
    check(
      'shop_interest_requests_contact_present_check',
      sql`${table.email} is not null or ${table.phone} is not null`,
    ),
  ],
)

export const shopHolds = pgTable(
  'shop_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => shopListings.id, { onDelete: 'cascade' }),
    interestRequestId: uuid('interest_request_id').references(() => shopInterestRequests.id, {
      onDelete: 'set null',
    }),
    status: shopHoldStatusEnum('status').notNull().default('active'),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    releasedBy: uuid('released_by').references(() => users.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shop_holds_one_active_per_listing_unique_idx')
      .on(table.listingId)
      .where(sql`${table.status} = 'active'`),
    index('shop_holds_listing_id_status_expires_at_idx').on(
      table.listingId,
      table.status,
      table.expiresAt,
    ),
    check('shop_holds_expires_after_created_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)
