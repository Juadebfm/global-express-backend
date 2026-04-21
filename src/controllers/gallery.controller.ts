import type { FastifyReply, FastifyRequest } from 'fastify'
import { successResponse } from '../utils/response'
import { galleryService } from '../services/gallery.service'
import { GalleryClaimStatus, GalleryClaimType, GalleryItemStatus, GalleryItemType, UserRole } from '../types/enums'

export const galleryController = {
  async getPublicGallery(
    request: FastifyRequest<{ Querystring: { limitPerSection?: string } }>,
    reply: FastifyReply,
  ) {
    const limitPerSection = Number(request.query.limitPerSection) || 20
    const payload = await galleryService.listPublicGallery(limitPerSection)
    return reply.send(successResponse(payload))
  },

  async getAuthenticatedGallery(
    request: FastifyRequest<{ Querystring: { limitPerSection?: string } }>,
    reply: FastifyReply,
  ) {
    const limitPerSection = Number(request.query.limitPerSection) || 20
    const payload = await galleryService.listGalleryForViewer({
      viewerId: request.user.id,
      limitPerSection,
    })
    return reply.send(successResponse(payload))
  },

  async generateClaimPresign(
    request: FastifyRequest<{
      Body: { uploadToken?: string; contentType: string; originalFileName?: string }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await galleryService.generateClaimProofUploadUrl({
      uploadToken: request.body.uploadToken,
      contentType: request.body.contentType,
      originalFileName: request.body.originalFileName,
    })

    return reply.send(successResponse(payload))
  },

  async submitPublicAnonymousClaim(
    request: FastifyRequest<{
      Params: { trackingNumber: string }
      Body: {
        fullName: string
        email: string
        phone: string
        city?: string
        country?: string
        message?: string
        uploadToken: string
        proofR2Keys: string[]
      }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await galleryService.submitAnonymousGoodsClaim({
      trackingNumber: request.params.trackingNumber,
      publicContact: {
        fullName: request.body.fullName,
        email: request.body.email,
        phone: request.body.phone,
        city: request.body.city,
        country: request.body.country,
      },
      message: request.body.message,
      uploadToken: request.body.uploadToken,
      proofR2Keys: request.body.proofR2Keys,
    })

    return reply.code(201).send(successResponse(payload))
  },

  async submitAuthenticatedAnonymousClaim(
    request: FastifyRequest<{
      Params: { trackingNumber: string }
      Body: { message?: string; uploadToken: string; proofR2Keys: string[] }
    }>,
    reply: FastifyReply,
  ) {
    if ([UserRole.STAFF, UserRole.SUPER_ADMIN].includes(request.user.role as UserRole)) {
      return reply.code(403).send({
        success: false,
        message: 'Internal roles cannot submit external anonymous-goods claims.',
      })
    }

    const payload = await galleryService.submitAnonymousGoodsClaim({
      trackingNumber: request.params.trackingNumber,
      authClaimant: {
        id: request.user.id,
        role: request.user.role as UserRole,
      },
      fallbackEmail: request.user.email,
      message: request.body.message,
      uploadToken: request.body.uploadToken,
      proofR2Keys: request.body.proofR2Keys,
    })

    return reply.code(201).send(successResponse(payload))
  },

  async submitPublicCarPurchaseAttempt(
    request: FastifyRequest<{
      Params: { trackingNumber: string }
      Body: {
        fullName: string
        email: string
        phone: string
        city?: string
        country?: string
        message?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await galleryService.submitCarPurchaseAttempt({
      trackingNumber: request.params.trackingNumber,
      publicContact: {
        fullName: request.body.fullName,
        email: request.body.email,
        phone: request.body.phone,
        city: request.body.city,
        country: request.body.country,
      },
      message: request.body.message,
    })

    return reply.code(201).send(successResponse(payload))
  },

  async submitAuthenticatedCarPurchaseAttempt(
    request: FastifyRequest<{
      Params: { trackingNumber: string }
      Body: { message?: string }
    }>,
    reply: FastifyReply,
  ) {
    if ([UserRole.STAFF, UserRole.SUPER_ADMIN].includes(request.user.role as UserRole)) {
      return reply.code(403).send({
        success: false,
        message: 'Internal roles cannot submit external car purchase attempts.',
      })
    }

    const payload = await galleryService.submitCarPurchaseAttempt({
      trackingNumber: request.params.trackingNumber,
      authClaimant: {
        id: request.user.id,
        role: request.user.role as UserRole,
      },
      fallbackEmail: request.user.email,
      message: request.body.message,
    })

    return reply.code(201).send(successResponse(payload))
  },

  async createItem(
    request: FastifyRequest<{
      Body: {
        itemType: GalleryItemType
        title: string
        description?: string
        previewImageUrl?: string
        mediaUrls?: string[]
        ctaUrl?: string
        startsAt?: string
        endsAt?: string
        isPublished?: boolean
        status?: GalleryItemStatus
        carPriceNgn?: string
        metadata?: Record<string, unknown>
      }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await galleryService.createItem({
      actorId: request.user.id,
      actorRole: request.user.role as UserRole,
      itemType: request.body.itemType,
      title: request.body.title,
      description: request.body.description,
      previewImageUrl: request.body.previewImageUrl,
      mediaUrls: request.body.mediaUrls,
      ctaUrl: request.body.ctaUrl,
      startsAt: request.body.startsAt ? new Date(request.body.startsAt) : undefined,
      endsAt: request.body.endsAt ? new Date(request.body.endsAt) : undefined,
      isPublished: request.body.isPublished,
      status: request.body.status,
      carPriceNgn: request.body.carPriceNgn,
      metadata: request.body.metadata,
    })

    return reply.code(201).send(successResponse(payload))
  },

  async updateItem(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        title?: string
        description?: string | null
        previewImageUrl?: string | null
        mediaUrls?: string[]
        ctaUrl?: string | null
        startsAt?: string | null
        endsAt?: string | null
        isPublished?: boolean
        status?: GalleryItemStatus
        carPriceNgn?: string | null
        metadata?: Record<string, unknown>
      }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await galleryService.updateItem({
      itemId: request.params.id,
      actorId: request.user.id,
      actorRole: request.user.role as UserRole,
      title: request.body.title,
      description: request.body.description,
      previewImageUrl: request.body.previewImageUrl,
      mediaUrls: request.body.mediaUrls,
      ctaUrl: request.body.ctaUrl,
      startsAt: request.body.startsAt === undefined ? undefined : request.body.startsAt ? new Date(request.body.startsAt) : null,
      endsAt: request.body.endsAt === undefined ? undefined : request.body.endsAt ? new Date(request.body.endsAt) : null,
      isPublished: request.body.isPublished,
      status: request.body.status,
      carPriceNgn: request.body.carPriceNgn,
      metadata: request.body.metadata,
    })

    return reply.send(successResponse(payload))
  },

  async listClaims(
    request: FastifyRequest<{
      Querystring: {
        status?: GalleryClaimStatus
        claimType?: GalleryClaimType
        itemTrackingNumber?: string
        limit?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await galleryService.listClaimsForInternal({
      status: request.query.status,
      claimType: request.query.claimType,
      itemTrackingNumber: request.query.itemTrackingNumber,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
    })

    return reply.send(successResponse(payload))
  },

  async reviewClaim(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { decision: 'approve' | 'reject'; note?: string }
    }>,
    reply: FastifyReply,
  ) {
    const payload = await galleryService.reviewClaim({
      claimId: request.params.id,
      reviewerId: request.user.id,
      decision: request.body.decision,
      note: request.body.note,
    })

    return reply.send(successResponse(payload))
  },
}
