import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { shopController } from '../controllers/shop.controller'
import { authenticate } from '../middleware/authenticate'
import { errorResponseSchema } from '../utils/problem-details'

const publicShopAvailabilitySchema = z.enum(['available'])
const publicShopCtaModeSchema = z.enum(['public_inquiry', 'auth_inquiry'])
const publicShopListingKindSchema = z.enum(['vehicle', 'general_item'])

const publicVehicleDetailsSchema = z.object({
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().int().nullable(),
  mileageKm: z.number().int().nullable(),
  fuelType: z.string().nullable(),
  transmission: z.string().nullable(),
  location: z.string().nullable(),
  exteriorColor: z.string().nullable(),
})

const publicItemDetailsSchema = z.object({
  category: z.string().nullable(),
  quantity: z.number().int().nullable(),
  condition: z.string().nullable(),
  sku: z.string().nullable(),
  location: z.string().nullable(),
})

const publicShopListingSchema = z.object({
  id: z.string().uuid(),
  listingKind: publicShopListingKindSchema,
  trackingNumberMasked: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  previewImageUrl: z.string().nullable(),
  mediaUrls: z.array(z.string()),
  priceAmount: z.string().nullable(),
  priceCurrency: z.string(),
  availability: publicShopAvailabilitySchema,
  ctaMode: publicShopCtaModeSchema,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  vehicleDetails: publicVehicleDetailsSchema.nullable(),
  itemDetails: publicItemDetailsSchema.nullable(),
})

const publicShopInterestResponseSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  status: z.enum(['new', 'contacted', 'qualified', 'hold_offered', 'converted', 'closed']),
  message: z.string().nullable(),
  createdAt: z.string(),
  item: publicShopListingSchema,
})

export async function shopRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/items/:listingId/inquiries', {
    preHandler: [authenticate],
    schema: {
      tags: ['Shop'],
      summary: 'Submit an authenticated inquiry for a general shop item',
      security: [{ bearerAuth: [] }],
      params: z.object({ listingId: z.string().uuid() }),
      body: z.object({
        message: z.string().max(2000).optional(),
      }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: publicShopInterestResponseSchema,
        }),
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: shopController.submitAuthenticatedItemInquiry,
  })
}

export {
  publicItemDetailsSchema,
  publicShopInterestResponseSchema,
  publicShopListingSchema,
  publicVehicleDetailsSchema,
}
