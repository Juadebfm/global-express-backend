import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { db } from '../config/db'
import { customerPricingOverrides, pricingRules } from '../../drizzle/schema'
import { PricingSource, TransportMode } from '../types/enums'

export interface AirTier {
  minKg: number
  maxKg: number | null
  usdPerKg: number
}

export interface PricingContext {
  mode: TransportMode
  weightKg?: number
  cbm?: number
}

export interface PricingResult {
  amountUsd: number
  mode: TransportMode
  pricingSource: PricingSource
}

interface AirRateRuleLike {
  minWeightKg: string | number | null
  maxWeightKg: string | number | null
  rateUsdPerKg: string | number | null
}

interface SeaRateRuleLike {
  minWeightKg: string | number | null
  maxWeightKg: string | number | null
  rateUsdPerKg: string | number | null
  flatRateUsdPerCbm: string | number | null
}

export const DEFAULT_AIR_TIERS: readonly AirTier[] = [
  { minKg: 1, maxKg: 100, usdPerKg: 13.5 },
  { minKg: 101, maxKg: 300, usdPerKg: 11.5 },
  { minKg: 301, maxKg: 600, usdPerKg: 10.8 },
  { minKg: 601, maxKg: 1000, usdPerKg: 10.5 },
  { minKg: 1001, maxKg: 1500, usdPerKg: 10.0 },
  { minKg: 1501, maxKg: null, usdPerKg: 9.8 },
]

/**
 * Sea chargeable-weight conversion:
 * kg = cbm * 550
 */
export const SEA_CBM_TO_KG_FACTOR = 550

/**
 * Default sea rate is now expressed per chargeable kilogram.
 * With DEFAULT_SEA_USD_PER_KG=1 and factor 550, the equivalent
 * baseline remains 550 USD/CBM (legacy behavior).
 */
export const DEFAULT_SEA_USD_PER_KG = 1
export const DEFAULT_SEA_USD_PER_CBM = SEA_CBM_TO_KG_FACTOR * DEFAULT_SEA_USD_PER_KG

function roundToTwo(n: number): number {
  return Math.round(n * 100) / 100
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function findAirTier(weightKg: number, tiers: readonly AirTier[]): AirTier {
  const tier = tiers.find((t) => {
    const minOk = weightKg >= t.minKg
    const maxOk = t.maxKg === null ? true : weightKg <= t.maxKg
    return minOk && maxOk
  })

  if (!tier) {
    throw new Error(`No air pricing tier configured for weight ${weightKg}kg`)
  }

  return tier
}

function inWeightRange(
  weightKg: number,
  minWeightKg: number | null,
  maxWeightKg: number | null,
): boolean {
  const minOk = minWeightKg === null ? true : weightKg >= minWeightKg
  const maxOk = maxWeightKg === null ? true : weightKg <= maxWeightKg
  return minOk && maxOk
}

export function pickAirRateFromRules(
  weightKg: number,
  rules: readonly AirRateRuleLike[],
): number | null {
  const candidates = rules
    .map((rule) => ({
      min: toNumber(rule.minWeightKg),
      max: toNumber(rule.maxWeightKg),
      rate: toNumber(rule.rateUsdPerKg),
    }))
    .filter(
      (rule): rule is { min: number | null; max: number | null; rate: number } =>
        rule.rate !== null && inWeightRange(weightKg, rule.min, rule.max),
    )
    .sort((a, b) => (b.min ?? -Infinity) - (a.min ?? -Infinity))

  return candidates[0]?.rate ?? null
}

export function pickSeaRateFromRules(
  chargeableWeightKg: number,
  rules: readonly SeaRateRuleLike[],
): number | null {
  const candidates = rules
    .map((rule) => {
      const perKgRate = toNumber(rule.rateUsdPerKg)
      const flatPerCbmRate = toNumber(rule.flatRateUsdPerCbm)

      // Backward compatibility: allow legacy sea flat-CBM rules by converting to per-kg.
      const normalizedPerKgRate =
        perKgRate ?? (flatPerCbmRate !== null ? flatPerCbmRate / SEA_CBM_TO_KG_FACTOR : null)

      return {
        min: toNumber(rule.minWeightKg),
        max: toNumber(rule.maxWeightKg),
        rate: normalizedPerKgRate,
      }
    })
    .filter(
      (rule): rule is { min: number | null; max: number | null; rate: number } =>
        rule.rate !== null && inWeightRange(chargeableWeightKg, rule.min, rule.max),
    )
    .sort((a, b) => (b.min ?? -Infinity) - (a.min ?? -Infinity))

  return candidates[0]?.rate ?? null
}

export interface ResolvedPricingContext extends PricingContext {
  customerId?: string
  at?: Date
}

export class PricingV2Service {
  async calculatePricing(context: ResolvedPricingContext): Promise<PricingResult> {
    // Always keep a deterministic fallback even if DB lookups fail.
    const fallbackDefault = this.calculateDefaultPricing(context)
    if (!context.customerId) return fallbackDefault

    const at = context.at ?? new Date()
    const customerId = context.customerId

    if (context.mode === TransportMode.AIR) {
      if (context.weightKg === undefined || context.weightKg <= 0) {
        throw new Error('Air pricing requires a positive weightKg')
      }

      const customerRules = await this.getActiveCustomerRules(customerId, TransportMode.AIR, at)
      const overrideRate = pickAirRateFromRules(context.weightKg, customerRules)
      if (overrideRate !== null) {
        return {
          amountUsd: roundToTwo(context.weightKg * overrideRate),
          mode: TransportMode.AIR,
          pricingSource: PricingSource.CUSTOMER_OVERRIDE,
        }
      }

      const defaultRules = await this.getActiveDefaultRules(TransportMode.AIR, at)
      const defaultRate = pickAirRateFromRules(context.weightKg, defaultRules)
      if (defaultRate !== null) {
        return {
          amountUsd: roundToTwo(context.weightKg * defaultRate),
          mode: TransportMode.AIR,
          pricingSource: PricingSource.DEFAULT_RATE,
        }
      }

      return fallbackDefault
    }

    const seaChargeableWeightKg = this.resolveSeaChargeableWeightKg(context)

    const customerRules = await this.getActiveCustomerRules(customerId, TransportMode.SEA, at)
    const overrideSeaRate = pickSeaRateFromRules(seaChargeableWeightKg, customerRules)
    if (overrideSeaRate !== null) {
      return {
        amountUsd: roundToTwo(seaChargeableWeightKg * overrideSeaRate),
        mode: TransportMode.SEA,
        pricingSource: PricingSource.CUSTOMER_OVERRIDE,
      }
    }

    const defaultRules = await this.getActiveDefaultRules(TransportMode.SEA, at)
    const defaultSeaRate = pickSeaRateFromRules(seaChargeableWeightKg, defaultRules)
    if (defaultSeaRate !== null) {
      return {
        amountUsd: roundToTwo(seaChargeableWeightKg * defaultSeaRate),
        mode: TransportMode.SEA,
        pricingSource: PricingSource.DEFAULT_RATE,
      }
    }

    return fallbackDefault
  }

  calculateDefaultPricing(context: PricingContext): PricingResult {
    if (context.mode === TransportMode.AIR) {
      if (context.weightKg === undefined || context.weightKg <= 0) {
        throw new Error('Air pricing requires a positive weightKg')
      }

      const tier = findAirTier(context.weightKg, DEFAULT_AIR_TIERS)
      return {
        amountUsd: roundToTwo(context.weightKg * tier.usdPerKg),
        mode: TransportMode.AIR,
        pricingSource: PricingSource.DEFAULT_RATE,
      }
    }

    const seaChargeableWeightKg = this.resolveSeaChargeableWeightKg(context)

    return {
      amountUsd: roundToTwo(seaChargeableWeightKg * DEFAULT_SEA_USD_PER_KG),
      mode: TransportMode.SEA,
      pricingSource: PricingSource.DEFAULT_RATE,
    }
  }

  private resolveSeaChargeableWeightKg(context: PricingContext): number {
    if (context.weightKg !== undefined && context.weightKg > 0) {
      return context.weightKg
    }

    if (context.cbm !== undefined && context.cbm > 0) {
      return context.cbm * SEA_CBM_TO_KG_FACTOR
    }

    throw new Error('Sea pricing requires a positive cbm or chargeable weightKg')
  }

  private async getActiveCustomerRules(
    customerId: string,
    mode: TransportMode,
    at: Date,
  ) {
    try {
      return await db
        .select()
        .from(customerPricingOverrides)
        .where(
          and(
            eq(customerPricingOverrides.customerId, customerId),
            eq(customerPricingOverrides.mode, mode),
            eq(customerPricingOverrides.isActive, true),
            or(
              isNull(customerPricingOverrides.startsAt),
              lte(customerPricingOverrides.startsAt, at),
            ),
            or(
              isNull(customerPricingOverrides.endsAt),
              gte(customerPricingOverrides.endsAt, at),
            ),
          ),
        )
        .orderBy(
          desc(customerPricingOverrides.updatedAt),
          desc(customerPricingOverrides.createdAt),
        )
    } catch (err) {
      // During staged rollout, fallback safely if tables aren't yet migrated.
      console.warn('[PricingV2] Falling back to default pricing (customer overrides unavailable):', err)
      return []
    }
  }

  private async getActiveDefaultRules(mode: TransportMode, at: Date) {
    try {
      return await db
        .select()
        .from(pricingRules)
        .where(
          and(
            eq(pricingRules.mode, mode),
            eq(pricingRules.isActive, true),
            or(isNull(pricingRules.effectiveFrom), lte(pricingRules.effectiveFrom, at)),
            or(isNull(pricingRules.effectiveTo), gte(pricingRules.effectiveTo, at)),
          ),
        )
        .orderBy(desc(pricingRules.updatedAt), desc(pricingRules.createdAt))
    } catch (err) {
      // During staged rollout, fallback safely if tables aren't yet migrated.
      console.warn('[PricingV2] Falling back to static tiers (default rules unavailable):', err)
      return []
    }
  }
}

export const pricingV2Service = new PricingV2Service()
