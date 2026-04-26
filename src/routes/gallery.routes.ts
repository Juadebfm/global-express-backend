import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { galleryController } from '../controllers/gallery.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove } from '../middleware/requireRole'

const galleryItemTypeSchema = z.enum(['anonymous_goods', 'car', 'advert'])
const galleryItemStatusSchema = z.enum([
  'draft',
  'published',
  'claim_pending',
  'claimed',
  'car_reserved',
  'car_sold',
  'archived',
])

const publicGalleryItemSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string(),
  trackingNumberMasked: z.string(),
  itemType: galleryItemTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  previewImageUrl: z.string().nullable(),
  mediaUrls: z.array(z.string()),
  ctaUrl: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  status: galleryItemStatusSchema,
  isPublished: z.boolean(),
  carPriceNgn: z.string().nullable(),
  priceCurrency: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const claimSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  itemTrackingNumber: z.string(),
  itemType: galleryItemTypeSchema,
  itemTitle: z.string(),
  claimType: z.enum(['ownership', 'car_purchase']),
  status: z.enum(['pending', 'approved', 'rejected']),
  claimantUserId: z.string().uuid().nullable(),
  claimantFullName: z.string().nullable(),
  claimantEmail: z.string().nullable(),
  claimantPhone: z.string().nullable(),
  message: z.string().nullable(),
  uploadToken: z.string().nullable(),
  proofUrls: z.array(z.string()),
  supportTicketId: z.string().uuid().nullable(),
  reviewNote: z.string().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const supportTicketSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string(),
  userId: z.string().uuid(),
  orderId: z.string().uuid().nullable(),
  category: z.string(),
  status: z.string(),
  subject: z.string(),
  assignedTo: z.string().uuid().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const claimActionResponseSchema = z.object({
  item: publicGalleryItemSchema,
  claim: claimSchema,
  ticket: supportTicketSchema,
})

const reviewClaimShipmentSchema = z.object({
  orderId: z.string().uuid(),
  orderTrackingNumber: z.string(),
  dispatchBatchId: z.string().uuid(),
  dispatchMasterTrackingNumber: z.string(),
})

export async function galleryRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Gallery'],
      summary: 'Get public gallery sections + my claim history',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        limitPerSection: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            anonymousGoods: z.array(publicGalleryItemSchema),
            cars: z.array(publicGalleryItemSchema),
            adverts: z.array(publicGalleryItemSchema),
            myClaims: z.array(claimSchema),
          }),
        }),
      },
    },
    handler: galleryController.getAuthenticatedGallery,
  })

  app.post('/claims/presign', {
    preHandler: [authenticate],
    schema: {
      tags: ['Gallery'],
      summary: 'Generate presigned URL for gallery claim proof upload',
      security: [{ bearerAuth: [] }],
      body: z.object({
        uploadToken: z.string().optional(),
        contentType: z.enum(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
        originalFileName: z.string().optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            uploadUrl: z.string().url(),
            r2Key: z.string(),
            publicUrl: z.string().url(),
            expiresInSeconds: z.number(),
            uploadToken: z.string(),
          }),
        }),
      },
    },
    handler: galleryController.generateClaimPresign,
  })

  app.post('/items/media/presign', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Gallery — Admin'],
      summary: 'Generate presigned URL for gallery item media upload',
      security: [{ bearerAuth: [] }],
      body: z.object({
        uploadToken: z.string().optional(),
        contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
        originalFileName: z.string().optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            uploadUrl: z.string().url(),
            r2Key: z.string(),
            publicUrl: z.string().url(),
            expiresInSeconds: z.number(),
            uploadToken: z.string(),
          }),
        }),
      },
    },
    handler: galleryController.generateItemMediaPresign,
  })

  app.post('/anonymous/:trackingNumber/claim', {
    preHandler: [authenticate],
    schema: {
      tags: ['Gallery'],
      summary: 'Submit ownership claim for anonymous goods (authenticated)',
      security: [{ bearerAuth: [] }],
      params: z.object({ trackingNumber: z.string().min(1) }),
      body: z.object({
        message: z.string().optional(),
        uploadToken: z.string().min(1),
        proofR2Keys: z.array(z.string().min(1)).min(1).max(5),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: claimActionResponseSchema }),
      },
    },
    handler: galleryController.submitAuthenticatedAnonymousClaim,
  })

  app.post('/cars/:trackingNumber/purchase-attempt', {
    preHandler: [authenticate],
    schema: {
      tags: ['Gallery'],
      summary: 'Submit first-come purchase attempt for a car listing (authenticated)',
      security: [{ bearerAuth: [] }],
      params: z.object({ trackingNumber: z.string().min(1) }),
      body: z.object({
        message: z.string().optional(),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: claimActionResponseSchema }),
      },
    },
    handler: galleryController.submitAuthenticatedCarPurchaseAttempt,
  })

  app.post('/items', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Gallery — Admin'],
      summary: 'Create gallery item (staff/superadmin)',
      security: [{ bearerAuth: [] }],
      body: z.object({
        itemType: galleryItemTypeSchema,
        title: z.string().min(2),
        description: z.string().optional(),
        previewImageUrl: z.string().url().optional(),
        mediaUrls: z.array(z.string().url()).optional(),
        ctaUrl: z.string().url().optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        isPublished: z.boolean().optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        carPriceNgn: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: publicGalleryItemSchema }),
      },
    },
    handler: galleryController.createItem,
  })

  app.post('/adverts', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Gallery — Admin'],
      summary: 'Create advert item (staff/superadmin)',
      security: [{ bearerAuth: [] }],
      body: z.object({
        title: z.string().min(2),
        description: z.string().optional(),
        previewImageUrl: z.string().url().optional(),
        mediaUrls: z.array(z.string().url()).optional(),
        ctaUrl: z.string().url().optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        isPublished: z.boolean().optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: publicGalleryItemSchema }),
      },
    },
    handler: galleryController.createAdvert,
  })

  app.patch('/items/:id', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Gallery — Admin'],
      summary: 'Update gallery item (staff/superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        title: z.string().min(2).optional(),
        description: z.string().nullable().optional(),
        previewImageUrl: z.string().url().nullable().optional(),
        mediaUrls: z.array(z.string().url()).optional(),
        ctaUrl: z.string().url().nullable().optional(),
        startsAt: z.string().datetime().nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
        isPublished: z.boolean().optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        carPriceNgn: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: publicGalleryItemSchema }),
      },
    },
    handler: galleryController.updateItem,
  })

  app.patch('/adverts/:id', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Gallery — Admin'],
      summary: 'Update advert item (staff/superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        title: z.string().min(2).optional(),
        description: z.string().nullable().optional(),
        previewImageUrl: z.string().url().nullable().optional(),
        mediaUrls: z.array(z.string().url()).optional(),
        ctaUrl: z.string().url().nullable().optional(),
        startsAt: z.string().datetime().nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
        isPublished: z.boolean().optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: publicGalleryItemSchema }),
      },
    },
    handler: galleryController.updateAdvert,
  })

  app.get('/claims', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Gallery — Admin'],
      summary: 'List gallery claims (staff/superadmin)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        claimType: z.enum(['ownership', 'car_purchase']).optional(),
        itemTrackingNumber: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.array(claimSchema) }),
      },
    },
    handler: galleryController.listClaims,
  })

  app.patch('/claims/:id/review', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Gallery — Admin'],
      summary: 'Approve or reject a claim/purchase attempt',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z
        .object({
          decision: z.enum(['approve', 'reject']),
          note: z.string().optional(),
          postApprovalAction: z.enum(['create_shipment', 'approve_only']).optional(),
          shipmentType: z.enum(['air', 'ocean', 'd2d']).optional(),
          d2dDispatchMode: z.enum(['air', 'sea']).optional(),
        })
        .superRefine((value, ctx) => {
          if (value.decision !== 'approve') return

          const action = value.postApprovalAction ?? 'approve_only'
          if (action === 'approve_only') return

          if (!value.shipmentType) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'shipmentType is required when postApprovalAction is create_shipment.',
              path: ['shipmentType'],
            })
          }

          if (value.shipmentType === 'd2d' && !value.d2dDispatchMode) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'd2dDispatchMode is required when shipmentType is d2d.',
              path: ['d2dDispatchMode'],
            })
          }
        }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            item: publicGalleryItemSchema,
            claim: claimSchema,
            shipment: reviewClaimShipmentSchema.nullable(),
          }),
        }),
      },
    },
    handler: galleryController.reviewClaim,
  })
}
