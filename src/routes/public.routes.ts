import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { errorResponseSchema } from '../utils/problem-details'
import { publicController } from '../controllers/public.controller'
import { galleryController } from '../controllers/gallery.controller'
import { shopController } from '../controllers/shop.controller'
import { requireCaptcha } from '../middleware/captcha'
import { getPublicShopAssetSvg, isPublicShopAssetKey } from '../utils/public-shop-assets'
import {
  publicShopInterestResponseSchema,
  publicShopListingSchema,
} from './shop.routes'

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>()

  const galleryItemTypeSchema = z.enum(['anonymous_goods', 'car', 'advert', 'for_sale'])
  const galleryItemStatusSchema = z.enum([
    'draft',
    'published',
    'claim_pending',
    'claimed',
    'car_reserved',
    'car_sold',
    'reserved',
    'sold',
    'archived',
  ])
  const publicShopAssetSchema = z.enum(['shop-car-sedan', 'shop-car-suv', 'shop-sale-item'])

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
    priceUsd: z.string().nullable(),
    priceCurrency: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })

  const optionalD2dStringSchema = z.preprocess(
    (value) => {
      if (typeof value === 'string' && value.trim().length === 0) {
        return undefined
      }
      return value
    },
    z.string().trim().min(1).max(255).optional(),
  )

  // POST /calculator/estimate — public shipment cost calculator
  server.post('/calculator/estimate', {
    schema: {
      tags: ['Public'],
      summary: 'Estimate shipment cost (no auth required)',
      description:
        'Returns a quick estimate for calculated shipment types (for example air/ocean). For intake-based types (for example D2D), returns an intake guidance payload and directs the user to submit details for tailored pricing.',
      body: z.object({
        shipmentType: z
          .string()
          .min(1)
          .describe('Public shipment type key, e.g. air | ocean | d2d (configured in settings)'),
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
            shipmentType: z.string(),
            mode: z.string().nullable(),
            weightKg: z.number().nullable(),
            cbm: z.number().nullable(),
            estimatedCostUsd: z.number().nullable(),
            estimatedCostNgn: z.number().nullable(),
            fxRateUsdNgn: z.number().nullable(),
            departureFrequency: z.string().nullable(),
            estimatedTransitDays: z.number().nullable(),
            disclaimer: z.string(),
            intake: z.object({
              title: z.string(),
              description: z.string(),
              submitEndpoint: z.string(),
              requiredFields: z.array(z.string()),
              nextStep: z.string(),
            }).optional(),
            d2dIntake: z.object({
              title: z.string(),
              description: z.string(),
              submitEndpoint: z.string(),
              requiredFields: z.array(z.string()),
              nextStep: z.string(),
            }).optional(),
            estimateDetails: z.object({
              input: z.object({
                shipmentType: z.string(),
                weightKgInput: z.number().nullable(),
                lengthCmInput: z.number().nullable(),
                widthCmInput: z.number().nullable(),
                heightCmInput: z.number().nullable(),
                cbmInput: z.number().nullable(),
              }),
              calculation: z.object({
                chargeBasis: z.enum([
                  'actual_weight',
                  'volumetric_weight',
                  'cbm_converted_to_kg',
                  'intake_required',
                ]),
                actualWeightKg: z.number().nullable(),
                volumetricWeightKg: z.number().nullable(),
                chargeableWeightKg: z.number().nullable(),
                cbmUsed: z.number().nullable(),
              }),
              pricing: z.object({
                estimatedCostUsd: z.number().nullable(),
                unitRateUsd: z.number().nullable(),
                currency: z.literal('USD'),
                airTier: z.object({
                  minKg: z.number(),
                  maxKg: z.number().nullable(),
                  rateUsdPerKg: z.number(),
                }).nullable(),
              }),
            }).optional(),
          }),
        }),
      },
    },
    handler: publicController.calculateEstimate,
  })

  server.get('/shipment-types', {
    schema: {
      tags: ['Public'],
      summary: 'List active shipment types (no auth required)',
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            items: z.array(z.object({
              key: z.string(),
              label: z.string(),
              coreShipmentType: z.enum(['air', 'ocean', 'd2d']),
              estimatorMode: z.enum(['CALCULATED', 'INTAKE']),
              intake: z.object({
                title: z.string(),
                description: z.string().nullable(),
                submitEndpoint: z.string().nullable(),
                requiredFields: z.array(z.string()),
                nextStep: z.string().nullable(),
              }).nullable(),
            })),
            updatedAt: z.string().nullable(),
          }),
        }),
      },
    },
    handler: publicController.listShipmentTypes,
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
    preHandler: [requireCaptcha],
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
      summary: 'Get public gallery sections (anonymous goods, sales, adverts)',
      querystring: z.object({
        limitPerSection: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            anonymousGoods: z.array(publicGalleryItemSchema),
            sales: z.array(publicGalleryItemSchema),
            // Backward-compat alias for existing clients.
            cars: z.array(publicGalleryItemSchema),
            forSale: z.array(publicGalleryItemSchema),
            adverts: z.array(publicGalleryItemSchema),
          }),
        }),
      },
    },
    handler: galleryController.getPublicGallery,
  })

  server.get('/shop/vehicles', {
    schema: {
      tags: ['Public Shop'],
      summary: 'List publicly available vehicle listings',
      querystring: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(publicShopListingSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
      },
    },
    handler: shopController.listPublicVehicles,
  })

  server.get('/shop/items', {
    schema: {
      tags: ['Public Shop'],
      summary: 'List publicly available general shop items',
      querystring: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(publicShopListingSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
      },
    },
    handler: shopController.listPublicItems,
  })

  server.post('/shop/vehicles/:listingId/inquiries', {
    preHandler: [requireCaptcha],
    schema: {
      tags: ['Public Shop'],
      summary: 'Submit a public inquiry for a vehicle listing',
      params: z.object({ listingId: z.string().uuid() }),
      body: z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(5),
        city: z.string().optional(),
        country: z.string().optional(),
        message: z.string().max(2000).optional(),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: publicShopInterestResponseSchema,
        }),
      },
    },
    handler: shopController.submitPublicVehicleInquiry,
  })

  // GET /gallery/adverts — public adverts only
  server.get('/gallery/adverts', {
    schema: {
      tags: ['Public'],
      summary: 'Get public adverts for gallery page',
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(publicGalleryItemSchema),
        }),
      },
    },
    handler: galleryController.getPublicAdverts,
  })

  // GET /gallery/assets/:assetName.svg — stable backend-served shop card assets
  server.get('/gallery/assets/:assetName.svg', {
    schema: {
      hide: true,
      params: z.object({
        assetName: publicShopAssetSchema,
      }),
    },
    handler: async (request, reply) => {
      const assetName = request.params.assetName

      if (!isPublicShopAssetKey(assetName)) {
        return reply.code(404).send({
          success: false,
          message: 'Asset not found',
        })
      }

      reply.header('Cache-Control', 'public, max-age=86400, immutable')
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin')
      reply.type('image/svg+xml; charset=utf-8')
      return reply.send(getPublicShopAssetSvg(assetName))
    },
  })

  // POST /d2d/intake — public unauthenticated D2D intake
  server.post('/d2d/intake', {
    preHandler: [requireCaptcha],
    schema: {
      tags: ['Public'],
      summary: 'Submit public D2D intake request (support ticket only)',
      description: `Creates a D2D intake support ticket for follow-up by internal staff.

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
          .min(3)
          .max(5000)
          .describe('Detailed description of goods for D2D intake review'),
        deliveryPhone: z.string().min(5).describe('Recipient or delivery contact phone number in Nigeria'),
        deliveryAddressLine1: z
          .string()
          .min(5)
          .describe('Primary intended delivery address in Nigeria'),
        deliveryState: optionalD2dStringSchema.describe('Optional delivery state in Nigeria'),
        deliveryCity: optionalD2dStringSchema.describe('Optional delivery city in Nigeria'),
        deliveryPostalCode: optionalD2dStringSchema.describe('Optional delivery postal/zip code in Nigeria'),
        deliveryLandmark: optionalD2dStringSchema.describe('Optional delivery landmark in Nigeria'),
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
            intakeRequest: z.object({
              fullName: z.string(),
              email: z.string().email(),
              phone: z.string(),
              city: z.string(),
              country: z.string(),
              goodsDescription: z.string(),
              wantsAccount: z.boolean(),
              estimatedWeightKg: z.number().nullable(),
              estimatedCbm: z.number().nullable(),
              delivery: z.object({
                phone: z.string(),
                addressLine1: z.string(),
                country: z.literal('Nigeria'),
                state: z.string().nullable(),
                city: z.string().nullable(),
                postalCode: z.string().nullable(),
                landmark: z.string().nullable(),
              }),
            }),
          }),
        }),
        409: errorResponseSchema,
      },
    },
    handler: publicController.submitD2dIntake,
  })

  // POST /contact — general contact / B2B enquiry form
  server.route({
    method: 'POST',
    url: '/contact',
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    preHandler: requireCaptcha,
    schema: {
      body: z.object({
        fullName: z.string().min(2).max(100),
        email: z.string().email().optional(),
        phone: z.string().min(5).max(30).optional(),
        message: z.string().min(10).max(2000),
      }),
    },
    handler: publicController.submitContactInquiry,
  })
}
