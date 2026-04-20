import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  pricingV2Service,
  DEFAULT_AIR_TIERS,
  DEFAULT_SEA_USD_PER_CBM,
  SEA_CBM_TO_KG_FACTOR,
} from '../services/pricing-v2.service'
import { TransportMode } from '../types/enums'
import { successResponse } from '../utils/response'
import { db } from '../config/db'
import { newsletterSubscribers } from '../../drizzle/schema'

const AIR_VOLUMETRIC_DIVISOR = 6000

export const publicController = {
  async calculateEstimate(
    request: FastifyRequest<{
      Body: {
        shipmentType: 'air' | 'ocean'
        weightKg?: number
        lengthCm?: number
        widthCm?: number
        heightCm?: number
        cbm?: number
      }
    }>,
    reply: FastifyReply,
  ) {
    const { shipmentType, weightKg, lengthCm, widthCm, heightCm } = request.body
    let { cbm } = request.body

    const mode = shipmentType === 'air' ? TransportMode.AIR : TransportMode.SEA

    // Auto-calculate CBM from dimensions if not provided directly
    if (!cbm && lengthCm && widthCm && heightCm) {
      cbm = (lengthCm * widthCm * heightCm) / 1_000_000
    }

    if (mode === TransportMode.AIR && (!weightKg || weightKg <= 0)) {
      return reply.code(400).send({
        success: false,
        message: 'weightKg is required and must be positive for air shipments',
      })
    }

    if (mode === TransportMode.SEA && (!cbm || cbm <= 0)) {
      return reply.code(400).send({
        success: false,
        message: 'cbm (or lengthCm + widthCm + heightCm) is required for sea/ocean shipments',
      })
    }

    try {
      const volumetricWeightKg =
        mode === TransportMode.AIR && cbm && cbm > 0
          ? (cbm * 1_000_000) / AIR_VOLUMETRIC_DIVISOR
          : undefined

      const billableAirWeightKg =
        mode === TransportMode.AIR ? Math.max(weightKg ?? 0, volumetricWeightKg ?? 0) : undefined

      const seaChargeableWeightKg =
        mode === TransportMode.SEA && cbm ? cbm * SEA_CBM_TO_KG_FACTOR : undefined

      const pricing = pricingV2Service.calculateDefaultPricing({
        mode,
        weightKg:
          mode === TransportMode.AIR
            ? billableAirWeightKg
            : mode === TransportMode.SEA
              ? seaChargeableWeightKg
              : undefined,
        cbm: mode === TransportMode.SEA ? cbm : undefined,
      })

      const departureFrequency = 'Event-driven (based on warehouse movement)'
      const estimatedTransitDays = mode === TransportMode.AIR ? 7 : 90

      return reply.send(
        successResponse({
          mode,
          weightKg: weightKg ?? null,
          cbm: cbm ? Math.round(cbm * 1_000_000) / 1_000_000 : null,
          estimatedCostUsd: pricing.amountUsd,
          departureFrequency,
          estimatedTransitDays,
          disclaimer:
            'This is an estimate based on standard rates. Final pricing is determined after warehouse verification of actual weight and volume. Rates are subject to change without prior notice.',
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pricing calculation failed'
      return reply.code(400).send({ success: false, message })
    }
  },

  async subscribeNewsletter(
    request: FastifyRequest<{ Body: { email: string } }>,
    reply: FastifyReply,
  ) {
    const email = request.body.email.toLowerCase().trim()

    try {
      await db.insert(newsletterSubscribers).values({ email })
      return reply.send(successResponse({ message: 'Successfully subscribed to the newsletter.' }))
    } catch (err: any) {
      if (err?.code === '23505') {
        return reply.send(successResponse({ message: 'You are already subscribed.' }))
      }
      throw err
    }
  },

  async getRates(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send(
      successResponse({
        air: {
          unit: 'USD per kg',
          tiers: DEFAULT_AIR_TIERS.map((t) => ({
            minKg: t.minKg,
            maxKg: t.maxKg,
            rateUsdPerKg: t.usdPerKg,
          })),
        },
        sea: {
          unit: 'USD per CBM',
          flatRateUsdPerCbm: DEFAULT_SEA_USD_PER_CBM,
        },
      }),
    )
  },
}
