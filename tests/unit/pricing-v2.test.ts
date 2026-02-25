import { beforeAll, describe, expect, it } from 'vitest'
import { TransportMode } from '../../src/types/enums'

type PricingV2ServiceModule = typeof import('../../src/services/pricing-v2.service')

let DEFAULT_AIR_TIERS: PricingV2ServiceModule['DEFAULT_AIR_TIERS']
let DEFAULT_SEA_USD_PER_CBM: PricingV2ServiceModule['DEFAULT_SEA_USD_PER_CBM']
let pickAirRateFromRules: PricingV2ServiceModule['pickAirRateFromRules']
let pickSeaRateFromRules: PricingV2ServiceModule['pickSeaRateFromRules']
let pricingV2Service: PricingV2ServiceModule['pricingV2Service']

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'development',
    PORT: '3001',
    HOST: '127.0.0.1',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    CLERK_SECRET_KEY: 'sk_test_placeholder',
    CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
    R2_ACCOUNT_ID: 'placeholder',
    R2_ACCESS_KEY_ID: 'placeholder',
    R2_SECRET_ACCESS_KEY: 'placeholder',
    R2_BUCKET_NAME: 'placeholder',
    R2_PUBLIC_URL: 'https://placeholder.example.com',
    RESEND_API_KEY: 'placeholder',
    RESEND_FROM_EMAIL: 'noreply@example.com',
    RESEND_FROM_NAME: 'Test',
    PAYSTACK_SECRET_KEY: 'sk_test_placeholder',
    PAYSTACK_PUBLIC_KEY: 'pk_test_placeholder',
    ENCRYPTION_KEY: 'a'.repeat(64),
    ADMIN_IP_WHITELIST: '127.0.0.1,::1',
    CORS_ORIGINS: 'http://localhost:3000',
    JWT_SECRET: 'b'.repeat(64),
  })

  const module = await import('../../src/services/pricing-v2.service')
  DEFAULT_AIR_TIERS = module.DEFAULT_AIR_TIERS
  DEFAULT_SEA_USD_PER_CBM = module.DEFAULT_SEA_USD_PER_CBM
  pickAirRateFromRules = module.pickAirRateFromRules
  pickSeaRateFromRules = module.pickSeaRateFromRules
  pricingV2Service = module.pricingV2Service
})

describe('pricing-v2 service', () => {
  it('contains the approved air tiers', () => {
    expect(DEFAULT_AIR_TIERS).toEqual([
      { minKg: 1, maxKg: 100, usdPerKg: 13.5 },
      { minKg: 101, maxKg: 300, usdPerKg: 11.5 },
      { minKg: 301, maxKg: 600, usdPerKg: 10.8 },
      { minKg: 601, maxKg: 1000, usdPerKg: 10.5 },
      { minKg: 1001, maxKg: 1500, usdPerKg: 10.0 },
      { minKg: 1501, maxKg: null, usdPerKg: 9.8 },
    ])
  })

  it('calculates air pricing using exact kg', () => {
    const result = pricingV2Service.calculateDefaultPricing({
      mode: TransportMode.AIR,
      weightKg: 110.5,
    })

    expect(result.amountUsd).toBe(1270.75)
    expect(result.mode).toBe(TransportMode.AIR)
  })

  it('calculates sea pricing using exact cbm', () => {
    const result = pricingV2Service.calculateDefaultPricing({
      mode: TransportMode.SEA,
      cbm: 1.234,
    })

    expect(result.amountUsd).toBe(678.7)
    expect(DEFAULT_SEA_USD_PER_CBM).toBe(550)
  })

  it('throws on invalid inputs', () => {
    expect(() =>
      pricingV2Service.calculateDefaultPricing({
        mode: TransportMode.AIR,
        weightKg: 0,
      }),
    ).toThrow()

    expect(() =>
      pricingV2Service.calculateDefaultPricing({
        mode: TransportMode.SEA,
        cbm: 0,
      }),
    ).toThrow()
  })

  it('picks the best matching air rate from configured rules', () => {
    const rate = pickAirRateFromRules(320, [
      { minWeightKg: '1', maxWeightKg: '100', rateUsdPerKg: '13.50' },
      { minWeightKg: '101', maxWeightKg: '300', rateUsdPerKg: '11.50' },
      { minWeightKg: '301', maxWeightKg: '600', rateUsdPerKg: '10.80' },
    ])

    expect(rate).toBe(10.8)
  })

  it('returns null when no air rule matches', () => {
    const rate = pickAirRateFromRules(50, [
      { minWeightKg: '101', maxWeightKg: '300', rateUsdPerKg: '11.50' },
    ])

    expect(rate).toBeNull()
  })

  it('picks the first valid sea flat rate from rules', () => {
    const rate = pickSeaRateFromRules([
      { flatRateUsdPerCbm: null },
      { flatRateUsdPerCbm: '550.00' },
      { flatRateUsdPerCbm: '600.00' },
    ])

    expect(rate).toBe(550)
  })
})
