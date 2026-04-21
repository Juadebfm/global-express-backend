import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { publicController } from '../controllers/public.controller'
import { galleryController } from '../controllers/gallery.controller'

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>()

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

  // POST /calculator/estimate — public shipment cost calculator
  server.post('/calculator/estimate', {
    schema: {
      tags: ['Public'],
      summary: 'Estimate shipment cost (no auth required)',
      body: z.object({
        shipmentType: z.enum(['air', 'ocean']),
        weightKg: z.number().positive().optional(),
        lengthCm: z.number().positive().optional(),
        widthCm: z.number().positive().optional(),
        heightCm: z.number().positive().optional(),
        cbm: z.number().positive().optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            mode: z.string(),
            weightKg: z.number().nullable(),
            cbm: z.number().nullable(),
            estimatedCostUsd: z.number(),
            departureFrequency: z.string(),
            estimatedTransitDays: z.number(),
            disclaimer: z.string(),
          }),
        }),
      },
    },
    handler: publicController.calculateEstimate,
  })

  // GET /calculator/rates — public rate sheet
  server.get('/calculator/rates', {
    schema: {
      tags: ['Public'],
      summary: 'Get current shipping rate tiers (no auth required)',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            air: z.object({
              unit: z.string(),
              tiers: z.array(
                z.object({
                  minKg: z.number(),
                  maxKg: z.number().nullable(),
                  rateUsdPerKg: z.number(),
                }),
              ),
            }),
            sea: z.object({
              unit: z.string(),
              flatRateUsdPerCbm: z.number(),
            }),
          }),
        }),
      },
    },
    handler: publicController.getRates,
  })

  // POST /newsletter/subscribe — public newsletter signup
  server.post('/newsletter/subscribe', {
    schema: {
      tags: ['Public'],
      summary: 'Subscribe to newsletter (no auth required)',
      body: z.object({
        email: z.string().email(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            message: z.string(),
          }),
        }),
      },
    },
    handler: publicController.subscribeNewsletter,
  })

  // GET /gallery — public gallery sections
  server.get('/gallery', {
    schema: {
      tags: ['Public'],
      summary: 'Get public gallery sections (anonymous goods, cars, adverts)',
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
          }),
        }),
      },
    },
    handler: galleryController.getPublicGallery,
  })

  // POST /gallery/claims/presign — public proof upload URL
  server.post('/gallery/claims/presign', {
    schema: {
      tags: ['Public'],
      summary: 'Generate presigned URL for gallery claim proof upload',
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

  // POST /gallery/anonymous/:trackingNumber/claim — public claim with proof
  server.post('/gallery/anonymous/:trackingNumber/claim', {
    schema: {
      tags: ['Public'],
      summary: 'Submit ownership claim for anonymous goods (public)',
      params: z.object({ trackingNumber: z.string().min(1) }),
      body: z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(5),
        city: z.string().optional(),
        country: z.string().optional(),
        message: z.string().optional(),
        uploadToken: z.string().min(1),
        proofR2Keys: z.array(z.string().min(1)).min(1).max(5),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            item: publicGalleryItemSchema,
            claim: claimSchema,
            ticket: supportTicketSchema,
          }),
        }),
      },
    },
    handler: galleryController.submitPublicAnonymousClaim,
  })

  // POST /gallery/cars/:trackingNumber/purchase-attempt — public first-come purchase attempt
  server.post('/gallery/cars/:trackingNumber/purchase-attempt', {
    schema: {
      tags: ['Public'],
      summary: 'Submit first-come purchase attempt for a car listing (public)',
      params: z.object({ trackingNumber: z.string().min(1) }),
      body: z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(5),
        city: z.string().optional(),
        country: z.string().optional(),
        message: z.string().optional(),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            item: publicGalleryItemSchema,
            claim: claimSchema,
            ticket: supportTicketSchema,
          }),
        }),
      },
    },
    handler: galleryController.submitPublicCarPurchaseAttempt,
  })

  // POST /d2d/intake — public unauthenticated D2D intake
  server.post('/d2d/intake', {
    schema: {
      tags: ['Public'],
      summary: 'Submit public D2D intake request (order + support ticket)',
      description: `Creates a D2D pre-order intake and an associated support ticket for follow-up by internal staff.

This endpoint is for users who are not signed in. Required contact + goods details are captured immediately.
The requester can indicate whether they want to register on the platform or remain an external contact.`,
      body: z.object({
        fullName: z.string().min(2).describe('Full name of the requester'),
        email: z.string().email().describe('Contact email'),
        phone: z.string().min(5).describe('Contact phone number'),
        city: z.string().min(1).describe('Current city'),
        country: z.string().min(1).describe('Current country'),
        goodsDescription: z
          .string()
          .min(10)
          .max(5000)
          .describe('Detailed description of goods for D2D intake review'),
        wantsAccount: z
          .boolean()
          .describe('True if requester wants to register on the platform, false to remain external'),
        consentAcknowledgement: z
          .literal(true)
          .describe('Must be true. Confirms provided details are accurate and can be used for intake follow-up'),
        estimatedWeightKg: z.number().positive().optional().describe('Estimated total weight in kg'),
        estimatedCbm: z.number().positive().optional().describe('Estimated total volume in CBM'),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            order: z.object({
              id: z.string().uuid(),
              trackingNumber: z.string(),
              shipmentType: z.string().nullable(),
              statusV2: z.string().nullable(),
            }),
            ticket: z.object({
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
            }),
            contact: z.object({
              userId: z.string().uuid(),
              role: z.string(),
              email: z.string().email(),
              accountLinked: z.boolean(),
              isActive: z.boolean(),
              registerIntent: z.boolean(),
            }),
          }),
        }),
        409: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: publicController.submitD2dIntake,
  })
}
