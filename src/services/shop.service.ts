import { and, count, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../config/db'
import {
  inboundLeads,
  shopHolds,
  shopItemDetails,
  shopInterestRequests,
  shopListings,
  shopVehicleDetails,
  users,
} from '../../drizzle/schema'
import { buildPaginatedResult, getPaginationOffset } from '../utils/pagination'
import type { PaginationParams } from '../types'
import {
  GalleryItemStatus,
  GalleryItemType,
  ShopInterestSource,
  ShopInterestStatus,
  ShopListingKind,
  ShopListingStatus,
  UserRole,
} from '../types/enums'
import { decrypt } from '../utils/encryption'
import { generateTrackingNumber, maskTrackingNumber } from '../utils/tracking'
import { notificationsService } from './notifications.service'

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return decrypt(value)
  } catch {
    return null
  }
}

function parseDisplayName(input: {
  firstName: string | null
  lastName: string | null
  businessName: string | null
}): string | null {
  const first = safeDecrypt(input.firstName)
  const last = safeDecrypt(input.lastName)
  const business = safeDecrypt(input.businessName)

  if (first && last) return `${first} ${last}`
  if (first) return first
  if (business) return business
  return null
}

type ShopListingRow = typeof shopListings.$inferSelect
type ShopVehicleDetailsRow = typeof shopVehicleDetails.$inferSelect
type ShopItemDetailsRow = typeof shopItemDetails.$inferSelect

type PublicContactInput = {
  fullName: string
  email?: string
  phone?: string
  city?: string
  country?: string
}

type AuthClaimantInput = {
  id: string
  role: UserRole
  fallbackEmail?: string
}

export interface ShopAdminCreateListingInput {
  actorId: string
  actorRole: UserRole
  itemType: GalleryItemType.CAR | GalleryItemType.FOR_SALE
  title: string
  description?: string
  previewImageUrl?: string
  mediaUrls?: string[]
  startsAt?: Date
  endsAt?: Date
  isPublished?: boolean
  status?: GalleryItemStatus
  carPriceNgn?: string
  priceUsd?: string
  metadata?: Record<string, unknown>
}

export interface ShopAdminUpdateListingInput {
  itemId: string
  actorId: string
  actorRole: UserRole
  title?: string
  description?: string | null
  previewImageUrl?: string | null
  mediaUrls?: string[]
  startsAt?: Date | null
  endsAt?: Date | null
  isPublished?: boolean
  status?: GalleryItemStatus
  carPriceNgn?: string | null
  priceUsd?: string | null
  metadata?: Record<string, unknown>
}

export class ShopService {
  private formatPublicVehicleDetails(details: ShopVehicleDetailsRow | null) {
    if (!details) return null

    return {
      make: details.make,
      model: details.model,
      year: details.year,
      mileageKm: details.mileageKm,
      fuelType: details.fuelType,
      transmission: details.transmission,
      location: details.location,
      exteriorColor: details.exteriorColor,
    }
  }

  private formatPublicItemDetails(details: ShopItemDetailsRow | null) {
    if (!details) return null

    return {
      category: details.category,
      quantity: details.quantity,
      condition: details.condition,
      sku: details.sku,
      location: details.location,
    }
  }

  private formatStructuredPublicListing(input: {
    listing: ShopListingRow
    vehicleDetails?: ShopVehicleDetailsRow | null
    itemDetails?: ShopItemDetailsRow | null
  }) {
    const { listing } = input
    const isVehicle = listing.listingKind === ShopListingKind.VEHICLE

    return {
      id: listing.id,
      listingKind: listing.listingKind,
      trackingNumberMasked: maskTrackingNumber(listing.trackingNumber),
      title: listing.title,
      description: listing.description,
      previewImageUrl: listing.previewImageUrl,
      mediaUrls: listing.mediaUrls,
      priceAmount: listing.isPricePublic ? listing.priceAmount : null,
      priceCurrency: listing.priceCurrency,
      availability: 'available' as const,
      ctaMode: isVehicle ? ('public_inquiry' as const) : ('auth_inquiry' as const),
      startsAt: listing.startsAt?.toISOString() ?? null,
      endsAt: listing.endsAt?.toISOString() ?? null,
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
      vehicleDetails: isVehicle
        ? this.formatPublicVehicleDetails(input.vehicleDetails ?? null)
        : null,
      itemDetails: isVehicle ? null : this.formatPublicItemDetails(input.itemDetails ?? null),
    }
  }

  private normalizeAdminStatus(input: {
    status?: GalleryItemStatus
    isPublished?: boolean
  }): ShopListingStatus {
    const requestedStatus =
      input.status ??
      (input.isPublished === true ? GalleryItemStatus.PUBLISHED : GalleryItemStatus.DRAFT)

    switch (requestedStatus) {
      case GalleryItemStatus.PUBLISHED:
        return ShopListingStatus.PUBLISHED
      case GalleryItemStatus.ARCHIVED:
        return ShopListingStatus.ARCHIVED
      case GalleryItemStatus.DRAFT:
        return input.isPublished === false ? ShopListingStatus.UNPUBLISHED : ShopListingStatus.DRAFT
      default:
        throw httpError('Only draft/published/archived can be set during admin listing changes', 422)
    }
  }

  private ensureAdminCanPrice(input: {
    actorRole: UserRole
    carPriceNgn?: string | null
    priceUsd?: string | null
  }) {
    if (
      (input.carPriceNgn !== undefined || input.priceUsd !== undefined) &&
      input.actorRole !== UserRole.SUPER_ADMIN
    ) {
      throw httpError('Only superadmin can set item pricing', 403)
    }
  }

  private derivePrice(input: {
    itemType: GalleryItemType.CAR | GalleryItemType.FOR_SALE
    carPriceNgn?: string | null
    priceUsd?: string | null
  }) {
    if (input.itemType === GalleryItemType.CAR) {
      return {
        listingKind: ShopListingKind.VEHICLE,
        priceCurrency: 'NGN',
        priceAmount: input.carPriceNgn ?? null,
      }
    }

    return {
      listingKind: ShopListingKind.GENERAL_ITEM,
      priceCurrency: 'USD',
      priceAmount: input.priceUsd ?? null,
    }
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private toNullableInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) return value
    if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
      return Number(value.trim())
    }
    return null
  }

  private extractVehicleDetails(metadata?: Record<string, unknown> | null) {
    const source = metadata ?? {}
    return {
      make: this.toNullableString(source.make),
      model: this.toNullableString(source.model),
      year: this.toNullableInteger(source.year),
      mileageKm: this.toNullableInteger(source.mileageKm),
      fuelType: this.toNullableString(source.fuelType),
      transmission: this.toNullableString(source.transmission),
      location: this.toNullableString(source.location),
      vin: this.toNullableString(source.vin),
      exteriorColor: this.toNullableString(source.exteriorColor),
      metadata: metadata ?? null,
    }
  }

  private extractItemDetails(metadata?: Record<string, unknown> | null) {
    const source = metadata ?? {}
    return {
      category: this.toNullableString(source.category),
      quantity: this.toNullableInteger(source.quantity),
      condition: this.toNullableString(source.condition),
      sku: this.toNullableString(source.sku),
      location: this.toNullableString(source.location),
      metadata: metadata ?? null,
    }
  }

  private publicVisibilityWhere(now: Date) {
    const nowIso = now.toISOString()

    return and(
      eq(shopListings.status, ShopListingStatus.PUBLISHED),
      or(isNull(shopListings.startsAt), lte(shopListings.startsAt, now)),
      or(isNull(shopListings.endsAt), gte(shopListings.endsAt, now)),
      sql`not exists (
        select 1
        from ${shopHolds} sh
        where sh.listing_id = ${shopListings.id}
          and sh.status = 'active'
          and sh.expires_at > ${nowIso}
      )`,
    )
  }

  private mapLegacyItemType(listing: ShopListingRow): GalleryItemType {
    return listing.listingKind === ShopListingKind.VEHICLE
      ? GalleryItemType.CAR
      : GalleryItemType.FOR_SALE
  }

  private mapLegacyStatus(listing: ShopListingRow): GalleryItemStatus {
    switch (listing.status) {
      case ShopListingStatus.SOLD:
        return listing.listingKind === ShopListingKind.VEHICLE
          ? GalleryItemStatus.CAR_SOLD
          : GalleryItemStatus.SOLD
      case ShopListingStatus.ARCHIVED:
        return GalleryItemStatus.ARCHIVED
      case ShopListingStatus.DRAFT:
      case ShopListingStatus.UNPUBLISHED:
        return GalleryItemStatus.DRAFT
      case ShopListingStatus.PUBLISHED:
      default:
        return GalleryItemStatus.PUBLISHED
    }
  }

  private formatPublicListing(listing: ShopListingRow) {
    const itemType = this.mapLegacyItemType(listing)
    const isVehicle = itemType === GalleryItemType.CAR
    const priceAmount = listing.priceAmount

    return {
      id: listing.id,
      trackingNumber: listing.trackingNumber,
      trackingNumberMasked: maskTrackingNumber(listing.trackingNumber),
      itemType,
      title: listing.title,
      description: listing.description,
      previewImageUrl: listing.previewImageUrl,
      mediaUrls: listing.mediaUrls,
      ctaUrl: null,
      startsAt: listing.startsAt?.toISOString() ?? null,
      endsAt: listing.endsAt?.toISOString() ?? null,
      status: this.mapLegacyStatus(listing),
      isPublished: listing.status === ShopListingStatus.PUBLISHED,
      carPriceNgn: isVehicle && listing.priceCurrency === 'NGN' ? priceAmount : null,
      priceUsd: !isVehicle ? priceAmount : null,
      priceCurrency: listing.priceCurrency,
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
    }
  }

  private async resolveAuthenticatedClaimant(input: AuthClaimantInput) {
    const [userRow] = await db.select().from(users).where(eq(users.id, input.id)).limit(1)

    if (!userRow) {
      throw httpError('User not found', 404)
    }

    const fullName = parseDisplayName(userRow) ?? 'Unknown'
    const email = safeDecrypt(userRow.email) ?? input.fallbackEmail ?? null
    const phone = safeDecrypt(userRow.phone)

    return {
      source: ShopInterestSource.AUTHENTICATED,
      requesterUserId: userRow.id,
      fullName,
      email,
      phone,
      role: input.role,
    }
  }

  private resolvePublicClaimant(input: PublicContactInput) {
    return {
      source: ShopInterestSource.PUBLIC,
      requesterUserId: null,
      fullName: input.fullName.trim(),
      email: input.email?.trim().toLowerCase() ?? null,
      phone: input.phone?.trim() ?? null,
      role: null,
    }
  }

  private async findAvailableListingByIdOrSource(itemId: string, expectedKind?: ShopListingKind) {
    const now = new Date()
    const [listing] = await db
      .select()
      .from(shopListings)
      .where(
        and(
          or(eq(shopListings.id, itemId), eq(shopListings.sourceGalleryItemId, itemId)),
          expectedKind ? eq(shopListings.listingKind, expectedKind) : undefined,
          this.publicVisibilityWhere(now),
        ),
      )
      .limit(1)

    if (!listing) {
      throw httpError('Shop listing not found or not currently available', 404)
    }

    return listing
  }

  private async getStructuredListingById(listingId: string) {
    const [row] = await db
      .select({
        listing: shopListings,
        vehicleDetails: shopVehicleDetails,
        itemDetails: shopItemDetails,
      })
      .from(shopListings)
      .leftJoin(shopVehicleDetails, eq(shopVehicleDetails.listingId, shopListings.id))
      .leftJoin(shopItemDetails, eq(shopItemDetails.listingId, shopListings.id))
      .where(eq(shopListings.id, listingId))
      .limit(1)

    if (!row) {
      throw httpError('Shop listing not found', 404)
    }

    return this.formatStructuredPublicListing(row)
  }

  private async listStructuredPublicListings(kind: ShopListingKind, params: PaginationParams) {
    const now = new Date()
    const offset = getPaginationOffset(params.page, params.limit)
    const whereClause = and(eq(shopListings.listingKind, kind), this.publicVisibilityWhere(now))

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          listing: shopListings,
          vehicleDetails: shopVehicleDetails,
          itemDetails: shopItemDetails,
        })
        .from(shopListings)
        .leftJoin(shopVehicleDetails, eq(shopVehicleDetails.listingId, shopListings.id))
        .leftJoin(shopItemDetails, eq(shopItemDetails.listingId, shopListings.id))
        .where(whereClause)
        .orderBy(desc(shopListings.publishedAt), desc(shopListings.createdAt))
        .limit(params.limit)
        .offset(offset),
      db.select({ total: count() }).from(shopListings).where(whereClause),
    ])

    return buildPaginatedResult(
      rows.map((row) => this.formatStructuredPublicListing(row)),
      Number(total),
      params,
    )
  }

  async listPublicSales(limit = 20) {
    const now = new Date()
    const rows = await db
      .select()
      .from(shopListings)
      .where(this.publicVisibilityWhere(now))
      .orderBy(desc(shopListings.publishedAt), desc(shopListings.createdAt))
      .limit(limit)

    return rows.map((row) => this.formatPublicListing(row))
  }

  async listPublicVehicles(params: PaginationParams) {
    return this.listStructuredPublicListings(ShopListingKind.VEHICLE, params)
  }

  async listPublicItems(params: PaginationParams) {
    return this.listStructuredPublicListings(ShopListingKind.GENERAL_ITEM, params)
  }

  async submitPublicVehicleInquiry(input: {
    listingId: string
    message?: string
    publicContact?: PublicContactInput
    authClaimant?: AuthClaimantInput
  }) {
    const listing = await this.findAvailableListingByIdOrSource(
      input.listingId,
      ShopListingKind.VEHICLE,
    )

    const interest = await this.createInterestRequestRecord({
      listing,
      message: input.message,
      publicContact: input.publicContact,
      authClaimant: input.authClaimant,
    })

    return {
      id: interest.id,
      listingId: listing.id,
      status: interest.status,
      message: interest.message,
      createdAt: interest.createdAt.toISOString(),
      item: await this.getStructuredListingById(listing.id),
    }
  }

  async submitAuthenticatedItemInquiry(input: {
    listingId: string
    message?: string
    authClaimant: AuthClaimantInput
  }) {
    const listing = await this.findAvailableListingByIdOrSource(
      input.listingId,
      ShopListingKind.GENERAL_ITEM,
    )

    const interest = await this.createInterestRequestRecord({
      listing,
      message: input.message,
      authClaimant: input.authClaimant,
    })

    return {
      id: interest.id,
      listingId: listing.id,
      status: interest.status,
      message: interest.message,
      createdAt: interest.createdAt.toISOString(),
      item: await this.getStructuredListingById(listing.id),
    }
  }

  private async createInterestRequestRecord(input: {
    listing: ShopListingRow
    message?: string
    publicContact?: PublicContactInput
    authClaimant?: AuthClaimantInput
  }) {
    const claimant = input.authClaimant
      ? await this.resolveAuthenticatedClaimant(input.authClaimant)
      : input.publicContact
        ? this.resolvePublicClaimant(input.publicContact)
        : null

    if (!claimant) {
      throw httpError('Claimant details are required', 400)
    }

    if (!claimant.email && !claimant.phone) {
      throw httpError('Either email or phone is required', 422)
    }

    const message = input.message?.trim() || null
    const now = new Date()
    const metadata = {
      listingTrackingNumber: input.listing.trackingNumber,
      listingKind: input.listing.listingKind,
      sourceGalleryItemId: input.listing.sourceGalleryItemId,
      priceAmount: input.listing.priceAmount,
      priceCurrency: input.listing.priceCurrency,
    }

    const { lead, interest } = await db.transaction(async (tx) => {
      const [lead] = await tx
        .insert(inboundLeads)
        .values({
          leadType: 'shop_inquiry',
          status: 'new',
          fullName: claimant.fullName,
          email: claimant.email,
          phone: claimant.phone,
          originCountry: null,
          message,
          itemId: input.listing.sourceGalleryItemId ?? null,
          userId: claimant.requesterUserId,
          metadata,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      const [interest] = await tx
        .insert(shopInterestRequests)
        .values({
          listingId: input.listing.id,
          source: claimant.source,
          status: ShopInterestStatus.NEW,
          sourceInboundLeadId: lead.id,
          requesterUserId: claimant.requesterUserId,
          assignedTo: null,
          supportTicketId: null,
          fullName: claimant.fullName,
          email: claimant.email,
          phone: claimant.phone,
          message,
          metadata,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      return { lead, interest }
    })

    void notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'admin_alert',
      title: 'New shop interest request',
      body: `${claimant.fullName} is interested in "${input.listing.title}" (${input.listing.trackingNumber}).`,
      createdBy: claimant.requesterUserId ?? undefined,
      metadata: {
        interestRequestId: interest.id,
        inboundLeadId: lead.id,
        listingId: input.listing.id,
        trackingNumber: input.listing.trackingNumber,
      },
    })

    return interest
  }

  async createAdminListing(input: ShopAdminCreateListingInput) {
    if (input.endsAt && input.startsAt && input.endsAt < input.startsAt) {
      throw httpError('endsAt must be greater than or equal to startsAt', 400)
    }

    this.ensureAdminCanPrice({
      actorRole: input.actorRole,
      carPriceNgn: input.carPriceNgn,
      priceUsd: input.priceUsd,
    })

    const status = this.normalizeAdminStatus({
      status: input.status,
      isPublished: input.isPublished,
    })
    const { listingKind, priceAmount, priceCurrency } = this.derivePrice(input)

    if (
      input.itemType === GalleryItemType.CAR &&
      status === ShopListingStatus.PUBLISHED &&
      (!priceAmount || Number(priceAmount) <= 0)
    ) {
      throw httpError('Published car listings require a valid carPriceNgn', 422)
    }

    if (
      input.itemType === GalleryItemType.FOR_SALE &&
      status === ShopListingStatus.PUBLISHED &&
      (!priceAmount || Number(priceAmount) <= 0)
    ) {
      throw httpError('Published for_sale listings require a valid priceUsd', 422)
    }

    const trackingNumber = await generateTrackingNumber()
    const now = new Date()
    const metadata = {
      ...(input.metadata ?? {}),
      shopSource: 'shop_listings',
    }

    const listing = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(shopListings)
        .values({
          trackingNumber,
          listingKind,
          status,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          previewImageUrl: input.previewImageUrl?.trim() || null,
          mediaUrls: input.mediaUrls ?? [],
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          priceAmount,
          priceCurrency,
          isPricePublic: Boolean(priceAmount && Number(priceAmount) > 0),
          sourceGalleryItemId: null,
          metadata,
          publishedAt: status === ShopListingStatus.PUBLISHED ? now : null,
          archivedAt: status === ShopListingStatus.ARCHIVED ? now : null,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      if (!created) {
        throw httpError('Unable to create shop listing. Please retry.', 500)
      }

      if (listingKind === ShopListingKind.VEHICLE) {
        await tx.insert(shopVehicleDetails).values({
          listingId: created.id,
          ...this.extractVehicleDetails(metadata),
          createdAt: now,
          updatedAt: now,
        })
      } else {
        await tx.insert(shopItemDetails).values({
          listingId: created.id,
          ...this.extractItemDetails(metadata),
          createdAt: now,
          updatedAt: now,
        })
      }

      return created
    })

    return this.formatPublicListing(listing)
  }

  async updateAdminListing(input: ShopAdminUpdateListingInput) {
    const [existing] = await db
      .select()
      .from(shopListings)
      .where(
        or(eq(shopListings.id, input.itemId), eq(shopListings.sourceGalleryItemId, input.itemId)),
      )
      .limit(1)

    if (!existing) {
      throw httpError('Shop listing not found', 404)
    }

    if (input.endsAt && input.startsAt && input.endsAt < input.startsAt) {
      throw httpError('endsAt must be greater than or equal to startsAt', 400)
    }

    const isVehicle = existing.listingKind === ShopListingKind.VEHICLE

    this.ensureAdminCanPrice({
      actorRole: input.actorRole,
      carPriceNgn: input.carPriceNgn,
      priceUsd: input.priceUsd,
    })

    const nextStatus =
      input.status !== undefined || input.isPublished !== undefined
        ? this.normalizeAdminStatus({
            status: input.status,
            isPublished: input.isPublished,
          })
        : existing.status

    const nextPriceAmount = isVehicle
      ? input.carPriceNgn === undefined
        ? existing.priceAmount
        : input.carPriceNgn
      : input.priceUsd === undefined
        ? existing.priceAmount
        : input.priceUsd

    if (
      isVehicle &&
      nextStatus === ShopListingStatus.PUBLISHED &&
      (!nextPriceAmount || Number(nextPriceAmount) <= 0)
    ) {
      throw httpError('Published car listings require a valid carPriceNgn', 422)
    }

    if (
      !isVehicle &&
      nextStatus === ShopListingStatus.PUBLISHED &&
      (!nextPriceAmount || Number(nextPriceAmount) <= 0)
    ) {
      throw httpError('Published for_sale listings require a valid priceUsd', 422)
    }

    const nextMetadata = input.metadata ?? (existing.metadata as Record<string, unknown> | null) ?? null
    const now = new Date()

    const listing = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(shopListings)
        .set({
          title: input.title?.trim() ?? existing.title,
          description:
            input.description === undefined ? existing.description : input.description,
          previewImageUrl:
            input.previewImageUrl === undefined
              ? existing.previewImageUrl
              : input.previewImageUrl,
          mediaUrls: input.mediaUrls ?? existing.mediaUrls,
          startsAt: input.startsAt === undefined ? existing.startsAt : input.startsAt,
          endsAt: input.endsAt === undefined ? existing.endsAt : input.endsAt,
          status: nextStatus,
          priceAmount: nextPriceAmount,
          priceCurrency: existing.priceCurrency,
          isPricePublic: Boolean(nextPriceAmount && Number(nextPriceAmount) > 0),
          metadata: nextMetadata,
          publishedAt:
            nextStatus === ShopListingStatus.PUBLISHED
              ? existing.publishedAt ?? now
              : nextStatus === ShopListingStatus.ARCHIVED ||
                  nextStatus === ShopListingStatus.DRAFT ||
                  nextStatus === ShopListingStatus.UNPUBLISHED
                ? null
                : existing.publishedAt,
          archivedAt:
            nextStatus === ShopListingStatus.ARCHIVED
              ? existing.archivedAt ?? now
              : null,
          updatedBy: input.actorId,
          updatedAt: now,
        })
        .where(eq(shopListings.id, existing.id))
        .returning()

      if (!updated) {
        throw httpError('Shop listing not found', 404)
      }

      if (isVehicle) {
        const [detail] = await tx
          .select()
          .from(shopVehicleDetails)
          .where(eq(shopVehicleDetails.listingId, existing.id))
          .limit(1)

        const nextDetails = {
          listingId: existing.id,
          ...this.extractVehicleDetails(nextMetadata),
          createdAt: detail?.createdAt ?? now,
          updatedAt: now,
        }

        if (detail) {
          await tx
            .update(shopVehicleDetails)
            .set({
              make: nextDetails.make,
              model: nextDetails.model,
              year: nextDetails.year,
              mileageKm: nextDetails.mileageKm,
              fuelType: nextDetails.fuelType,
              transmission: nextDetails.transmission,
              location: nextDetails.location,
              vin: nextDetails.vin,
              exteriorColor: nextDetails.exteriorColor,
              metadata: nextDetails.metadata,
              updatedAt: now,
            })
            .where(eq(shopVehicleDetails.listingId, existing.id))
        } else {
          await tx.insert(shopVehicleDetails).values(nextDetails)
        }
      } else {
        const [detail] = await tx
          .select()
          .from(shopItemDetails)
          .where(eq(shopItemDetails.listingId, existing.id))
          .limit(1)

        const nextDetails = {
          listingId: existing.id,
          ...this.extractItemDetails(nextMetadata),
          createdAt: detail?.createdAt ?? now,
          updatedAt: now,
        }

        if (detail) {
          await tx
            .update(shopItemDetails)
            .set({
              category: nextDetails.category,
              quantity: nextDetails.quantity,
              condition: nextDetails.condition,
              sku: nextDetails.sku,
              location: nextDetails.location,
              metadata: nextDetails.metadata,
              updatedAt: now,
            })
            .where(eq(shopItemDetails.listingId, existing.id))
        } else {
          await tx.insert(shopItemDetails).values(nextDetails)
        }
      }

      return updated
    })

    return this.formatPublicListing(listing)
  }
}

export const shopService = new ShopService()
