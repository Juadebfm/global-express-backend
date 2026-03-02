import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { publicController } from '../controllers/public.controller'

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>()

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
}
