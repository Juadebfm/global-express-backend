import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  boolean,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { supportTickets } from './support-tickets'

export const galleryItemTypeEnum = pgEnum('gallery_item_type', [
  'anonymous_goods',
  'car',
  'advert',
])

export const galleryItemStatusEnum = pgEnum('gallery_item_status', [
  'draft',
  'published',
  'claim_pending',
  'claimed',
  'car_reserved',
  'car_sold',
  'archived',
])

export const galleryClaimTypeEnum = pgEnum('gallery_claim_type', [
  'ownership',
  'car_purchase',
])

export const galleryClaimStatusEnum = pgEnum('gallery_claim_status', [
  'pending',
  'approved',
  'rejected',
])

export const galleryItems = pgTable(
  'gallery_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingNumber: text('tracking_number').notNull(),
    itemType: galleryItemTypeEnum('item_type').notNull(),
    status: galleryItemStatusEnum('status').notNull().default('draft'),
    title: text('title').notNull(),
    description: text('description'),
    previewImageUrl: text('preview_image_url'),
    mediaUrls: jsonb('media_urls').$type<string[]>().notNull().default([]),
    ctaUrl: text('cta_url'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isPublished: boolean('is_published').notNull().default(false),
    carPriceNgn: numeric('car_price_ngn', { precision: 14, scale: 2 }),
    priceCurrency: text('price_currency').notNull().default('NGN'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    assignedSupplierId: uuid('assigned_supplier_id').references(() => users.id),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('gallery_items_tracking_number_unique_idx').on(table.trackingNumber),
    index('gallery_items_item_type_idx').on(table.itemType),
    index('gallery_items_status_idx').on(table.status),
    index('gallery_items_is_published_idx').on(table.isPublished),
    index('gallery_items_created_at_idx').on(table.createdAt),
  ],
)

export const galleryClaims = pgTable(
  'gallery_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id').notNull().references(() => galleryItems.id, { onDelete: 'cascade' }),
    claimType: galleryClaimTypeEnum('claim_type').notNull(),
    status: galleryClaimStatusEnum('status').notNull().default('pending'),
    claimantUserId: uuid('claimant_user_id').references(() => users.id),
    claimantFullName: text('claimant_full_name').notNull(),
    claimantEmail: text('claimant_email').notNull(),
    claimantPhone: text('claimant_phone').notNull(),
    message: text('message'),
    uploadToken: text('upload_token'),
    proofUrls: jsonb('proof_urls').$type<string[]>().notNull().default([]),
    supportTicketId: uuid('support_ticket_id').references(() => supportTickets.id, {
      onDelete: 'set null',
    }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('gallery_claims_item_id_idx').on(table.itemId),
    index('gallery_claims_status_idx').on(table.status),
    index('gallery_claims_created_at_idx').on(table.createdAt),
  ],
)
