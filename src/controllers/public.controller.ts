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
import { publicD2dIntakeService } from '../services/public-d2d-intake.service'
import { settingsShipmentTypesService } from '../services/settings-shipment-types.service'

const AIR_VOLUMETRIC_DIVISOR = 6000

function round(value: number, places = 3): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export const publicController = {
  async calculateEstimate(
    request: FastifyRequest<{
      Body: {
        shipmentType: string
        weightKg?: number
        lengthCm?: number
        widthCm?: number
        heightCm?: number
        cbm?: number
      }
    }>,
    reply: FastifyReply,
  ) {
    const shipmentType = request.body.shipmentType.trim().toLowerCase()
    const { weightKg, lengthCm, widthCm, heightCm } = request.body
    let { cbm } = request.body
    const rawCbm = request.body.cbm

    const configuredType = await settingsShipmentTypesService.getActiveShipmentTypeByKey(
      shipmentType,
    )

    if (!configuredType) {
      const available = await settingsShipmentTypesService.getShipmentTypeSettings({
        includeInactive: false,
      })
      return reply.code(400).send({
        success: false,
        message: `Unsupported shipmentType "${shipmentType}". Available types: ${available.items
          .map((item) => item.key)
          .join(', ')}`,
      })
    }

    if (configuredType.estimatorMode === 'INTAKE') {
      const intake = {
        title: configuredType.infoTitle ?? configuredType.label,
        description:
          configuredType.infoDescription ??
          `Submit your ${configuredType.label} details and our team will review and provide tailored guidance.`,
        submitEndpoint: configuredType.submitEndpoint ?? '/api/v1/public/d2d/intake',
        requiredFields: configuredType.requiredFields,
        nextStep:
          configuredType.nextStep ??
          'Submit your details and our team will contact you with tailored pricing and next actions.',
      }
      return reply.send(
        successResponse({
          shipmentType: configuredType.key,
          mode: null,
          weightKg: null,
          cbm: null,
          estimatedCostUsd: null,
          departureFrequency: null,
          estimatedTransitDays: null,
          disclaimer:
            `${configuredType.label} pricing is customized after intake review because final cost depends on route details, goods profile, and last-mile handling needs.`,
          intake,
          d2dIntake: configuredType.key === 'd2d' ? intake : undefined,
          estimateDetails: {
            input: {
              shipmentType: configuredType.key,
              weightKgInput: weightKg ?? null,
              lengthCmInput: lengthCm ?? null,
              widthCmInput: widthCm ?? null,
              heightCmInput: heightCm ?? null,
              cbmInput: rawCbm ?? null,
            },
            calculation: {
              chargeBasis: 'intake_required',
              actualWeightKg: null,
              volumetricWeightKg: null,
              chargeableWeightKg: null,
              cbmUsed: null,
            },
            pricing: {
              estimatedCostUsd: null,
              unitRateUsd: null,
              currency: 'USD',
              airTier: null,
            },
          },
        }),
      )
    }

    if (configuredType.coreShipmentType === 'd2d') {
      return reply.code(400).send({
        success: false,
        message:
          `Shipment type "${configuredType.key}" is misconfigured: CALCULATED mode supports only coreShipmentType air or ocean.`,
      })
    }

    const mode =
      configuredType.coreShipmentType === 'air' ? TransportMode.AIR : TransportMode.SEA

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

      const matchedAirTier =
        mode === TransportMode.AIR && billableAirWeightKg
          ? DEFAULT_AIR_TIERS.find((tier) => {
              const minOk = billableAirWeightKg >= tier.minKg
              const maxOk = tier.maxKg === null ? true : billableAirWeightKg <= tier.maxKg
              return minOk && maxOk
            }) ?? null
          : null

      const chargeableWeightKg =
        mode === TransportMode.AIR
          ? billableAirWeightKg ?? null
          : mode === TransportMode.SEA
            ? seaChargeableWeightKg ?? null
            : null

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

      const unitRateUsd =
        chargeableWeightKg && chargeableWeightKg > 0
          ? round(pricing.amountUsd / chargeableWeightKg, 4)
          : null

      const chargeBasis =
        mode === TransportMode.AIR
          ? (volumetricWeightKg ?? 0) > (weightKg ?? 0)
            ? 'volumetric_weight'
            : 'actual_weight'
          : 'cbm_converted_to_kg'

      const departureFrequency = 'Event-driven (based on warehouse movement)'
      const estimatedTransitDays = mode === TransportMode.AIR ? 7 : 90

      return reply.send(
        successResponse({
          shipmentType: configuredType.key,
          mode,
          weightKg: weightKg ?? null,
          cbm: cbm ? round(cbm, 6) : null,
          estimatedCostUsd: pricing.amountUsd,
          departureFrequency,
          estimatedTransitDays,
          disclaimer:
            'This is an estimate based on standard rates. Final pricing is determined after warehouse verification of actual weight and volume. Rates are subject to change without prior notice.',
          estimateDetails: {
            input: {
              shipmentType: configuredType.key,
              weightKgInput: weightKg ?? null,
              lengthCmInput: lengthCm ?? null,
              widthCmInput: widthCm ?? null,
              heightCmInput: heightCm ?? null,
              cbmInput: rawCbm ?? null,
            },
            calculation: {
              chargeBasis,
              actualWeightKg: mode === TransportMode.AIR ? weightKg ?? null : null,
              volumetricWeightKg:
                mode === TransportMode.AIR && volumetricWeightKg
                  ? round(volumetricWeightKg, 3)
                  : null,
              chargeableWeightKg: chargeableWeightKg ? round(chargeableWeightKg, 3) : null,
              cbmUsed: cbm ? round(cbm, 6) : null,
            },
            pricing: {
              estimatedCostUsd: pricing.amountUsd,
              unitRateUsd,
              currency: 'USD',
              airTier:
                mode === TransportMode.AIR && matchedAirTier
                  ? {
                      minKg: matchedAirTier.minKg,
                      maxKg: matchedAirTier.maxKg,
                      rateUsdPerKg: matchedAirTier.usdPerKg,
                    }
                  : null,
            },
          },
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

  async listShipmentTypes(_request: FastifyRequest, reply: FastifyReply) {
    const settings = await settingsShipmentTypesService.getShipmentTypeSettings({
      includeInactive: false,
    })

    return reply.send(
      successResponse({
        items: settings.items.map((item) => ({
          key: item.key,
          label: item.label,
          coreShipmentType: item.coreShipmentType,
          estimatorMode: item.estimatorMode,
          intake:
            item.estimatorMode === 'INTAKE'
              ? {
                  title: item.infoTitle ?? item.label,
                  description: item.infoDescription ?? null,
                  submitEndpoint: item.submitEndpoint ?? null,
                  requiredFields: item.requiredFields,
                  nextStep: item.nextStep ?? null,
                }
              : null,
        })),
        updatedAt: settings.updatedAt,
      }),
    )
  },

  async submitD2dIntake(
    request: FastifyRequest<{
      Body: {
        fullName: string
        email: string
        phone: string
        city: string
        country: string
        goodsDescription: string
        deliveryPhone: string
        deliveryAddressLine1: string
        deliveryState?: string
        deliveryCity?: string
        deliveryPostalCode?: string
        deliveryLandmark?: string
        wantsAccount: boolean
        estimatedWeightKg?: number
        estimatedCbm?: number
      }
    }>,
    reply: FastifyReply,
  ) {
    const result = await publicD2dIntakeService.submitIntake({
      fullName: request.body.fullName,
      email: request.body.email,
      phone: request.body.phone,
      city: request.body.city,
      country: request.body.country,
      goodsDescription: request.body.goodsDescription,
      deliveryPhone: request.body.deliveryPhone,
      deliveryAddressLine1: request.body.deliveryAddressLine1,
      deliveryState: request.body.deliveryState,
      deliveryCity: request.body.deliveryCity,
      deliveryPostalCode: request.body.deliveryPostalCode,
      deliveryLandmark: request.body.deliveryLandmark,
      wantsAccount: request.body.wantsAccount,
      estimatedWeightKg: request.body.estimatedWeightKg,
      estimatedCbm: request.body.estimatedCbm,
    })

    return reply.code(201).send(successResponse(result))
  },
}
