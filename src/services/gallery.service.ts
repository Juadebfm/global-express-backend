import { randomUUID } from 'crypto'
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { db } from '../config/db'
import { galleryClaims, galleryItems, users } from '../../drizzle/schema'
import { encrypt, decrypt, hashEmail } from '../utils/encryption'
import {
  GalleryClaimStatus,
  GalleryClaimType,
  GalleryItemStatus,
  GalleryItemType,
  UserRole,
} from '../types/enums'
import { generateTrackingNumber } from '../utils/tracking'
import { uploadsService } from './uploads.service'
import { supportService } from './support.service'
import { notificationsService, notifyUser } from './notifications.service'
import { env } from '../config/env'

const ALLOWED_PROOF_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

const MAX_PROOF_FILES = 5

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

function isInternalRole(role: string): boolean {
  return role === UserRole.STAFF || role === UserRole.SUPER_ADMIN
}

function splitFullName(fullName: string) {
  const normalized = fullName.trim().replace(/\s+/g, ' ')
  const [first, ...rest] = normalized.split(' ')
  const firstName = first ?? normalized
  const lastName = rest.length > 0 ? rest.join(' ') : null
  return { firstName, lastName }
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

export interface GalleryPublicListResult {
  anonymousGoods: Array<ReturnType<GalleryService['formatPublicItem']>>
  cars: Array<ReturnType<GalleryService['formatPublicItem']>>
  adverts: Array<ReturnType<GalleryService['formatPublicItem']>>
}

export interface GalleryCreateItemInput {
  actorId: string
  actorRole: UserRole
  itemType: GalleryItemType
  title: string
  description?: string
  previewImageUrl?: string
  mediaUrls?: string[]
  ctaUrl?: string
  startsAt?: Date
  endsAt?: Date
  isPublished?: boolean
  status?: GalleryItemStatus
  carPriceNgn?: string
  metadata?: Record<string, unknown>
}

export interface GalleryUpdateItemInput {
  itemId: string
  actorId: string
  actorRole: UserRole
  title?: string
  description?: string | null
  previewImageUrl?: string | null
  mediaUrls?: string[]
  ctaUrl?: string | null
  startsAt?: Date | null
  endsAt?: Date | null
  isPublished?: boolean
  status?: GalleryItemStatus
  carPriceNgn?: string | null
  metadata?: Record<string, unknown>
}

export interface PublicClaimContactInput {
  fullName: string
  email: string
  phone: string
  city?: string
  country?: string
}

interface AuthClaimantInput {
  id: string
  role: UserRole
}

interface ResolvedClaimant {
  userId: string
  role: UserRole
  fullName: string
  email: string
  phone: string
}

export class GalleryService {
  private formatPublicItem(item: typeof galleryItems.$inferSelect) {
    return {
      id: item.id,
      trackingNumber: item.trackingNumber,
      itemType: item.itemType,
      title: item.title,
      description: item.description,
      previewImageUrl: item.previewImageUrl,
      mediaUrls: item.mediaUrls,
      ctaUrl: item.ctaUrl,
      startsAt: item.startsAt?.toISOString() ?? null,
      endsAt: item.endsAt?.toISOString() ?? null,
      status: item.status,
      isPublished: item.isPublished,
      carPriceNgn: item.carPriceNgn,
      priceCurrency: item.priceCurrency,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }
  }

  private formatClaim(input: {
    claim: typeof galleryClaims.$inferSelect
    item: Pick<typeof galleryItems.$inferSelect, 'trackingNumber' | 'itemType' | 'title'>
  }) {
    return {
      id: input.claim.id,
      itemId: input.claim.itemId,
      itemTrackingNumber: input.item.trackingNumber,
      itemType: input.item.itemType,
      itemTitle: input.item.title,
      claimType: input.claim.claimType,
      status: input.claim.status,
      claimantUserId: input.claim.claimantUserId,
      claimantFullName: safeDecrypt(input.claim.claimantFullName),
      claimantEmail: safeDecrypt(input.claim.claimantEmail),
      claimantPhone: safeDecrypt(input.claim.claimantPhone),
      message: input.claim.message,
      uploadToken: input.claim.uploadToken,
      proofUrls: input.claim.proofUrls,
      supportTicketId: input.claim.supportTicketId,
      reviewNote: input.claim.reviewNote,
      reviewedBy: input.claim.reviewedBy,
      reviewedAt: input.claim.reviewedAt?.toISOString() ?? null,
      createdAt: input.claim.createdAt.toISOString(),
      updatedAt: input.claim.updatedAt.toISOString(),
    }
  }

  private async resolveOrCreatePublicClaimant(input: PublicClaimContactInput) {
    const normalizedEmail = input.email.trim().toLowerCase()
    const normalizedPhone = input.phone.trim()
    const emailHash = hashEmail(normalizedEmail)
    const { firstName, lastName } = splitFullName(input.fullName)

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1)

    if (existing) {
      if (existing.deletedAt) {
        throw httpError('This email belongs to a deleted account. Please contact support.', 409)
      }

      if (isInternalRole(existing.role)) {
        throw httpError(
          'This email belongs to an internal account and cannot be used for public claims.',
          409,
        )
      }

      const patch: Partial<typeof users.$inferInsert> = {}

      if (!existing.emailHash) patch.emailHash = emailHash
      if (!existing.firstName && firstName) patch.firstName = encrypt(firstName)
      if (!existing.lastName && lastName) patch.lastName = encrypt(lastName)
      if (!existing.phone) patch.phone = encrypt(normalizedPhone)
      if (!existing.addressCity && input.city?.trim()) patch.addressCity = input.city.trim()
      if (!existing.addressCountry && input.country?.trim()) patch.addressCountry = input.country.trim()

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date()

        const [updated] = await db
          .update(users)
          .set(patch)
          .where(eq(users.id, existing.id))
          .returning()

        return updated ?? existing
      }

      return existing
    }

    const [created] = await db
      .insert(users)
      .values({
        clerkId: null,
        role: UserRole.USER,
        email: encrypt(normalizedEmail),
        emailHash,
        firstName: encrypt(firstName),
        lastName: lastName ? encrypt(lastName) : null,
        phone: encrypt(normalizedPhone),
        addressCity: input.city?.trim() || null,
        addressCountry: input.country?.trim() || null,
        isActive: false,
      })
      .returning()

    return created
  }

  private async resolveClaimant(input: {
    authClaimant?: AuthClaimantInput
    publicContact?: PublicClaimContactInput
    fallbackEmail?: string
  }): Promise<ResolvedClaimant> {
    if (input.authClaimant) {
      const [existing] = await db
        .select({
          id: users.id,
          role: users.role,
          email: users.email,
          phone: users.phone,
          firstName: users.firstName,
          lastName: users.lastName,
          businessName: users.businessName,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .where(eq(users.id, input.authClaimant.id))
        .limit(1)

      if (!existing || existing.deletedAt) {
        throw httpError('Authenticated user not found', 404)
      }

      const fullName =
        parseDisplayName({
          firstName: existing.firstName,
          lastName: existing.lastName,
          businessName: existing.businessName,
        }) ?? 'Authenticated User'

      const email = safeDecrypt(existing.email) ?? input.fallbackEmail ?? 'unknown@example.com'
      const phone = safeDecrypt(existing.phone)

      if (!phone) {
        throw httpError('A phone number is required before submitting this request.', 422)
      }

      return {
        userId: existing.id,
        role: existing.role as UserRole,
        fullName,
        email,
        phone,
      }
    }

    if (!input.publicContact) {
      throw httpError('Public contact details are required', 422)
    }

    const claimantUser = await this.resolveOrCreatePublicClaimant(input.publicContact)

    return {
      userId: claimantUser.id,
      role: claimantUser.role as UserRole,
      fullName: input.publicContact.fullName.trim(),
      email: input.publicContact.email.trim().toLowerCase(),
      phone: input.publicContact.phone.trim(),
    }
  }

  private async getVisibleItemsByType(itemType: GalleryItemType, limitPerSection: number) {
    const now = new Date()

    return db
      .select()
      .from(galleryItems)
      .where(
        and(
          eq(galleryItems.itemType, itemType),
          eq(galleryItems.isPublished, true),
          eq(galleryItems.status, GalleryItemStatus.PUBLISHED),
          or(isNull(galleryItems.startsAt), lte(galleryItems.startsAt, now)),
          or(isNull(galleryItems.endsAt), gte(galleryItems.endsAt, now)),
        ),
      )
      .orderBy(desc(galleryItems.createdAt))
      .limit(limitPerSection)
  }

  private validateUploadTokenAndProofs(input: {
    uploadToken: string
    proofR2Keys: string[]
  }): string[] {
    const uniqueKeys = [...new Set(input.proofR2Keys)]

    if (uniqueKeys.length === 0) {
      throw httpError('At least one proof file is required', 422)
    }

    if (uniqueKeys.length > MAX_PROOF_FILES) {
      throw httpError(`A maximum of ${MAX_PROOF_FILES} proof files is allowed`, 422)
    }

    const expectedPrefix = `gallery-claims/${input.uploadToken}/`

    for (const key of uniqueKeys) {
      if (!key.startsWith(expectedPrefix)) {
        throw httpError('Invalid proof key for the provided upload token', 400)
      }
    }

    return uniqueKeys.map((key) => `${env.R2_PUBLIC_URL}/${key}`)
  }

  private async rollbackClaimAfterTicketFailure(input: {
    claimId: string
    itemId: string
    resetStatus: GalleryItemStatus
  }) {
    await db.transaction(async (tx) => {
      await tx
        .update(galleryClaims)
        .set({
          status: GalleryClaimStatus.REJECTED,
          reviewNote: 'Auto-rejected because support ticket creation failed.',
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(galleryClaims.id, input.claimId))

      await tx
        .update(galleryItems)
        .set({
          status: input.resetStatus,
          isPublished: true,
          updatedAt: new Date(),
        })
        .where(eq(galleryItems.id, input.itemId))
    })
  }

  async listPublicGallery(limitPerSection = 20): Promise<GalleryPublicListResult> {
    const safeLimit = Math.min(Math.max(limitPerSection, 1), 100)

    const [anonymousGoods, cars, adverts] = await Promise.all([
      this.getVisibleItemsByType(GalleryItemType.ANONYMOUS_GOODS, safeLimit),
      this.getVisibleItemsByType(GalleryItemType.CAR, safeLimit),
      this.getVisibleItemsByType(GalleryItemType.ADVERT, safeLimit),
    ])

    return {
      anonymousGoods: anonymousGoods.map((item) => this.formatPublicItem(item)),
      cars: cars.map((item) => this.formatPublicItem(item)),
      adverts: adverts.map((item) => this.formatPublicItem(item)),
    }
  }

  async listGalleryForViewer(input: { viewerId: string; limitPerSection?: number }) {
    const sections = await this.listPublicGallery(input.limitPerSection ?? 20)

    const claimRows = await db
      .select({
        claim: galleryClaims,
        item: {
          trackingNumber: galleryItems.trackingNumber,
          itemType: galleryItems.itemType,
          title: galleryItems.title,
        },
      })
      .from(galleryClaims)
      .innerJoin(galleryItems, eq(galleryItems.id, galleryClaims.itemId))
      .where(eq(galleryClaims.claimantUserId, input.viewerId))
      .orderBy(desc(galleryClaims.createdAt))

    return {
      ...sections,
      myClaims: claimRows.map((row) => this.formatClaim({ claim: row.claim, item: row.item })),
    }
  }

  async generateClaimProofUploadUrl(input: {
    uploadToken?: string
    contentType: string
    originalFileName?: string
  }) {
    if (!ALLOWED_PROOF_CONTENT_TYPES.has(input.contentType)) {
      throw httpError(
        `Unsupported content type. Allowed: ${[...ALLOWED_PROOF_CONTENT_TYPES].join(', ')}`,
        400,
      )
    }

    const uploadToken = input.uploadToken?.trim() || randomUUID()

    const payload = await uploadsService.generateGalleryClaimProofPresignedUrl({
      uploadToken,
      contentType: input.contentType,
      originalFileName: input.originalFileName,
    })

    return {
      ...payload,
      uploadToken,
    }
  }

  async createItem(input: GalleryCreateItemInput) {
    if (input.endsAt && input.startsAt && input.endsAt < input.startsAt) {
      throw httpError('endsAt must be greater than or equal to startsAt', 400)
    }

    if (input.itemType !== GalleryItemType.CAR && input.carPriceNgn !== undefined) {
      throw httpError('carPriceNgn is only allowed for car items', 400)
    }

    if (input.carPriceNgn !== undefined && input.actorRole !== UserRole.SUPER_ADMIN) {
      throw httpError('Only superadmin can set car pricing', 403)
    }

    const requestedStatus = input.status ?? (input.isPublished ? GalleryItemStatus.PUBLISHED : GalleryItemStatus.DRAFT)

    if (
      ![GalleryItemStatus.DRAFT, GalleryItemStatus.PUBLISHED, GalleryItemStatus.ARCHIVED].includes(
        requestedStatus,
      )
    ) {
      throw httpError('Only draft/published/archived can be set during creation', 422)
    }

    if (
      input.itemType === GalleryItemType.CAR &&
      requestedStatus === GalleryItemStatus.PUBLISHED &&
      (!input.carPriceNgn || Number(input.carPriceNgn) <= 0)
    ) {
      throw httpError('Published car listings require a valid carPriceNgn', 422)
    }

    let created: typeof galleryItems.$inferSelect | null = null

    for (let i = 0; i < 5; i += 1) {
      const trackingNumber = generateTrackingNumber()
      try {
        const [row] = await db
          .insert(galleryItems)
          .values({
            trackingNumber,
            itemType: input.itemType,
            status: requestedStatus,
            title: input.title.trim(),
            description: input.description?.trim() || null,
            previewImageUrl: input.previewImageUrl?.trim() || null,
            mediaUrls: input.mediaUrls ?? [],
            ctaUrl: input.ctaUrl?.trim() || null,
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
            isPublished: requestedStatus === GalleryItemStatus.PUBLISHED,
            carPriceNgn: input.carPriceNgn ?? null,
            metadata: input.metadata ?? null,
            createdBy: input.actorId,
            updatedBy: input.actorId,
            archivedAt: requestedStatus === GalleryItemStatus.ARCHIVED ? new Date() : null,
          })
          .returning()

        created = row
        break
      } catch (err: any) {
        if (err?.code === '23505') {
          continue
        }
        throw err
      }
    }

    if (!created) {
      throw httpError('Unable to create gallery item. Please retry.', 500)
    }

    return this.formatPublicItem(created)
  }

  async updateItem(input: GalleryUpdateItemInput) {
    const [existing] = await db
      .select()
      .from(galleryItems)
      .where(eq(galleryItems.id, input.itemId))
      .limit(1)

    if (!existing) {
      throw httpError('Gallery item not found', 404)
    }

    if (input.endsAt && input.startsAt && input.endsAt < input.startsAt) {
      throw httpError('endsAt must be greater than or equal to startsAt', 400)
    }

    if (input.carPriceNgn !== undefined && existing.itemType !== GalleryItemType.CAR) {
      throw httpError('carPriceNgn is only allowed for car items', 400)
    }

    if (input.carPriceNgn !== undefined && input.actorRole !== UserRole.SUPER_ADMIN) {
      throw httpError('Only superadmin can set car pricing', 403)
    }

    const nextStatus =
      input.status ??
      (input.isPublished === true
        ? GalleryItemStatus.PUBLISHED
        : input.isPublished === false && existing.status === GalleryItemStatus.PUBLISHED
          ? GalleryItemStatus.DRAFT
          : existing.status)

    if (
      input.status !== undefined &&
      ![GalleryItemStatus.DRAFT, GalleryItemStatus.PUBLISHED, GalleryItemStatus.ARCHIVED].includes(
        input.status,
      )
    ) {
      throw httpError('Only draft/published/archived can be set directly on item update', 422)
    }

    if (
      existing.itemType === GalleryItemType.CAR &&
      nextStatus === GalleryItemStatus.PUBLISHED &&
      Number(input.carPriceNgn ?? existing.carPriceNgn ?? 0) <= 0
    ) {
      throw httpError('Published car listings require a valid carPriceNgn', 422)
    }

    const nextIsPublished =
      input.isPublished !== undefined
        ? input.isPublished
        : nextStatus === GalleryItemStatus.PUBLISHED

    const [updated] = await db
      .update(galleryItems)
      .set({
        title: input.title?.trim() ?? existing.title,
        description: input.description === undefined ? existing.description : input.description,
        previewImageUrl:
          input.previewImageUrl === undefined ? existing.previewImageUrl : input.previewImageUrl,
        mediaUrls: input.mediaUrls ?? existing.mediaUrls,
        ctaUrl: input.ctaUrl === undefined ? existing.ctaUrl : input.ctaUrl,
        startsAt: input.startsAt === undefined ? existing.startsAt : input.startsAt,
        endsAt: input.endsAt === undefined ? existing.endsAt : input.endsAt,
        status: nextStatus,
        isPublished: nextIsPublished,
        carPriceNgn:
          input.carPriceNgn === undefined
            ? existing.carPriceNgn
            : input.carPriceNgn,
        metadata: input.metadata ?? existing.metadata,
        updatedBy: input.actorId,
        archivedAt:
          nextStatus === GalleryItemStatus.ARCHIVED
            ? existing.archivedAt ?? new Date()
            : null,
        updatedAt: new Date(),
      })
      .where(eq(galleryItems.id, existing.id))
      .returning()

    return this.formatPublicItem(updated)
  }

  async submitAnonymousGoodsClaim(input: {
    trackingNumber: string
    message?: string
    uploadToken: string
    proofR2Keys: string[]
    authClaimant?: AuthClaimantInput
    publicContact?: PublicClaimContactInput
    fallbackEmail?: string
  }) {
    const claimant = await this.resolveClaimant({
      authClaimant: input.authClaimant,
      publicContact: input.publicContact,
      fallbackEmail: input.fallbackEmail,
    })

    const proofUrls = this.validateUploadTokenAndProofs({
      uploadToken: input.uploadToken,
      proofR2Keys: input.proofR2Keys,
    })

    const [target] = await db
      .select()
      .from(galleryItems)
      .where(eq(galleryItems.trackingNumber, input.trackingNumber))
      .limit(1)

    if (!target) {
      throw httpError('Gallery item not found', 404)
    }

    if (target.itemType !== GalleryItemType.ANONYMOUS_GOODS) {
      throw httpError('This item is not claimable as anonymous goods', 422)
    }

    const now = new Date()

    const { lockedItem, claim } = await db.transaction(async (tx) => {
      const [locked] = await tx
        .update(galleryItems)
        .set({
          status: GalleryItemStatus.CLAIM_PENDING,
          isPublished: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(galleryItems.id, target.id),
            eq(galleryItems.status, GalleryItemStatus.PUBLISHED),
            eq(galleryItems.isPublished, true),
          ),
        )
        .returning()

      if (!locked) {
        throw httpError('This item is no longer available for claims', 409)
      }

      const [newClaim] = await tx
        .insert(galleryClaims)
        .values({
          itemId: target.id,
          claimType: GalleryClaimType.OWNERSHIP,
          status: GalleryClaimStatus.PENDING,
          claimantUserId: claimant.userId,
          claimantFullName: encrypt(claimant.fullName),
          claimantEmail: encrypt(claimant.email),
          claimantPhone: encrypt(claimant.phone),
          message: input.message?.trim() || null,
          uploadToken: input.uploadToken,
          proofUrls,
        })
        .returning()

      return { lockedItem: locked, claim: newClaim }
    })

    try {
      const ticket = await supportService.createTicket(
        {
          subject: `Anonymous goods claim - ${lockedItem.trackingNumber}`,
          category: 'shipment_inquiry',
          body:
            `Anonymous goods claim submitted.\n\n` +
            `Tracking: ${lockedItem.trackingNumber}\n` +
            `Item title: ${lockedItem.title}\n` +
            `Claimant: ${claimant.fullName}\n` +
            `Email: ${claimant.email}\n` +
            `Phone: ${claimant.phone}\n\n` +
            `Message:\n${input.message?.trim() || 'No message provided.'}\n\n` +
            `Proof files:\n${proofUrls.map((url) => `- ${url}`).join('\n')}`,
        },
        { id: claimant.userId, role: claimant.role },
      )

      const [updatedClaim] = await db
        .update(galleryClaims)
        .set({ supportTicketId: ticket.ticket.id, updatedAt: new Date() })
        .where(eq(galleryClaims.id, claim.id))
        .returning()

      notificationsService.notifyRole({
        targetRole: UserRole.STAFF,
        type: 'admin_alert',
        title: 'New Anonymous Goods Claim',
        body: `Claim submitted for ${lockedItem.trackingNumber}.`,
        metadata: {
          claimId: claim.id,
          trackingNumber: lockedItem.trackingNumber,
          supportTicketId: ticket.ticket.id,
        },
      })

      return {
        item: this.formatPublicItem(lockedItem),
        claim: this.formatClaim({
          claim: updatedClaim,
          item: {
            trackingNumber: lockedItem.trackingNumber,
            itemType: lockedItem.itemType,
            title: lockedItem.title,
          },
        }),
        ticket: ticket.ticket,
      }
    } catch (err) {
      await this.rollbackClaimAfterTicketFailure({
        claimId: claim.id,
        itemId: lockedItem.id,
        resetStatus: GalleryItemStatus.PUBLISHED,
      })
      throw err
    }
  }

  async submitCarPurchaseAttempt(input: {
    trackingNumber: string
    message?: string
    authClaimant?: AuthClaimantInput
    publicContact?: PublicClaimContactInput
    fallbackEmail?: string
  }) {
    const claimant = await this.resolveClaimant({
      authClaimant: input.authClaimant,
      publicContact: input.publicContact,
      fallbackEmail: input.fallbackEmail,
    })

    const [target] = await db
      .select()
      .from(galleryItems)
      .where(eq(galleryItems.trackingNumber, input.trackingNumber))
      .limit(1)

    if (!target) {
      throw httpError('Gallery item not found', 404)
    }

    if (target.itemType !== GalleryItemType.CAR) {
      throw httpError('This item is not a car listing', 422)
    }

    if (!target.carPriceNgn || Number(target.carPriceNgn) <= 0) {
      throw httpError('This car listing is not priced yet', 409)
    }

    const now = new Date()

    const { lockedItem, claim } = await db.transaction(async (tx) => {
      const [locked] = await tx
        .update(galleryItems)
        .set({
          status: GalleryItemStatus.CAR_RESERVED,
          isPublished: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(galleryItems.id, target.id),
            eq(galleryItems.status, GalleryItemStatus.PUBLISHED),
            eq(galleryItems.isPublished, true),
          ),
        )
        .returning()

      if (!locked) {
        throw httpError('This car is no longer available. Another buyer already reserved it.', 409)
      }

      const [newClaim] = await tx
        .insert(galleryClaims)
        .values({
          itemId: target.id,
          claimType: GalleryClaimType.CAR_PURCHASE,
          status: GalleryClaimStatus.PENDING,
          claimantUserId: claimant.userId,
          claimantFullName: encrypt(claimant.fullName),
          claimantEmail: encrypt(claimant.email),
          claimantPhone: encrypt(claimant.phone),
          message: input.message?.trim() || null,
          proofUrls: [],
        })
        .returning()

      return { lockedItem: locked, claim: newClaim }
    })

    try {
      const ticket = await supportService.createTicket(
        {
          subject: `Car purchase attempt - ${lockedItem.trackingNumber}`,
          category: 'general',
          body:
            `Car purchase attempt submitted (first-come-first-serve).\n\n` +
            `Tracking: ${lockedItem.trackingNumber}\n` +
            `Car title: ${lockedItem.title}\n` +
            `Listed price (${lockedItem.priceCurrency}): ${lockedItem.carPriceNgn}\n` +
            `Buyer: ${claimant.fullName}\n` +
            `Email: ${claimant.email}\n` +
            `Phone: ${claimant.phone}\n\n` +
            `Message:\n${input.message?.trim() || 'No message provided.'}`,
        },
        { id: claimant.userId, role: claimant.role },
      )

      const [updatedClaim] = await db
        .update(galleryClaims)
        .set({ supportTicketId: ticket.ticket.id, updatedAt: new Date() })
        .where(eq(galleryClaims.id, claim.id))
        .returning()

      notificationsService.notifyRole({
        targetRole: UserRole.STAFF,
        type: 'admin_alert',
        title: 'New Car Purchase Attempt',
        body: `Purchase attempt received for ${lockedItem.trackingNumber}.`,
        metadata: {
          claimId: claim.id,
          trackingNumber: lockedItem.trackingNumber,
          supportTicketId: ticket.ticket.id,
        },
      })

      return {
        item: this.formatPublicItem(lockedItem),
        claim: this.formatClaim({
          claim: updatedClaim,
          item: {
            trackingNumber: lockedItem.trackingNumber,
            itemType: lockedItem.itemType,
            title: lockedItem.title,
          },
        }),
        ticket: ticket.ticket,
      }
    } catch (err) {
      await this.rollbackClaimAfterTicketFailure({
        claimId: claim.id,
        itemId: lockedItem.id,
        resetStatus: GalleryItemStatus.PUBLISHED,
      })
      throw err
    }
  }

  async listClaimsForInternal(input: {
    status?: GalleryClaimStatus
    claimType?: GalleryClaimType
    itemTrackingNumber?: string
    limit?: number
  }) {
    const conditions = []

    if (input.status) conditions.push(eq(galleryClaims.status, input.status))
    if (input.claimType) conditions.push(eq(galleryClaims.claimType, input.claimType))
    if (input.itemTrackingNumber) {
      conditions.push(eq(galleryItems.trackingNumber, input.itemTrackingNumber))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)

    const rows = await db
      .select({
        claim: galleryClaims,
        item: {
          trackingNumber: galleryItems.trackingNumber,
          itemType: galleryItems.itemType,
          title: galleryItems.title,
        },
      })
      .from(galleryClaims)
      .innerJoin(galleryItems, eq(galleryItems.id, galleryClaims.itemId))
      .where(where)
      .orderBy(desc(galleryClaims.createdAt))
      .limit(limit)

    return rows.map((row) => this.formatClaim({ claim: row.claim, item: row.item }))
  }

  async reviewClaim(input: {
    claimId: string
    reviewerId: string
    decision: 'approve' | 'reject'
    note?: string
  }) {
    const [row] = await db
      .select({
        claim: galleryClaims,
        item: galleryItems,
      })
      .from(galleryClaims)
      .innerJoin(galleryItems, eq(galleryItems.id, galleryClaims.itemId))
      .where(eq(galleryClaims.id, input.claimId))
      .limit(1)

    if (!row) {
      throw httpError('Claim not found', 404)
    }

    if (row.claim.status !== GalleryClaimStatus.PENDING) {
      throw httpError('Only pending claims can be reviewed', 409)
    }

    const isApproved = input.decision === 'approve'
    const reviewedAt = new Date()

    const [updatedClaim] = await db
      .update(galleryClaims)
      .set({
        status: isApproved ? GalleryClaimStatus.APPROVED : GalleryClaimStatus.REJECTED,
        reviewedBy: input.reviewerId,
        reviewedAt,
        reviewNote: input.note ?? null,
        updatedAt: reviewedAt,
      })
      .where(eq(galleryClaims.id, row.claim.id))
      .returning()

    const nextItemStatus = (() => {
      if (!isApproved) return GalleryItemStatus.PUBLISHED
      if (row.claim.claimType === GalleryClaimType.OWNERSHIP) return GalleryItemStatus.CLAIMED
      return GalleryItemStatus.CAR_SOLD
    })()

    const [updatedItem] = await db
      .update(galleryItems)
      .set({
        status: nextItemStatus,
        isPublished: nextItemStatus === GalleryItemStatus.PUBLISHED,
        assignedUserId: isApproved ? row.claim.claimantUserId : null,
        updatedBy: input.reviewerId,
        updatedAt: reviewedAt,
      })
      .where(eq(galleryItems.id, row.item.id))
      .returning()

    if (updatedClaim.claimantUserId) {
      await notifyUser({
        userId: updatedClaim.claimantUserId,
        type: 'system_announcement',
        title: isApproved ? 'Gallery Request Approved' : 'Gallery Request Rejected',
        subtitle: updatedItem.trackingNumber,
        body: isApproved
          ? 'Your gallery request has been approved. Our team will contact you with next steps.'
          : 'Your gallery request was not approved at this time.',
        createdBy: input.reviewerId,
        metadata: {
          claimId: updatedClaim.id,
          trackingNumber: updatedItem.trackingNumber,
          decision: input.decision,
        },
      })
    }

    return {
      item: this.formatPublicItem(updatedItem),
      claim: this.formatClaim({
        claim: updatedClaim,
        item: {
          trackingNumber: updatedItem.trackingNumber,
          itemType: updatedItem.itemType,
          title: updatedItem.title,
        },
      }),
    }
  }
}

export const galleryService = new GalleryService()
