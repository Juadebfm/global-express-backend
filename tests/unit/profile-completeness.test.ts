import { beforeAll, describe, expect, it } from 'vitest'

type UsersServiceType = typeof import('../../src/services/users.service').UsersService
let UsersService: UsersServiceType
let usersService: InstanceType<UsersServiceType>

beforeAll(async () => {
  // UsersService imports env/db at module load time, so set required env first.
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

  const usersServiceModule = await import('../../src/services/users.service')
  UsersService = usersServiceModule.UsersService
  usersService = new UsersService()
})

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    businessName: null,
    phone: '+15550001111',
    whatsappNumber: null,
    addressStreet: '12 Main St',
    addressCity: 'Austin',
    addressState: 'TX',
    addressCountry: 'USA',
    addressPostalCode: '78701',
    ...overrides,
  } as any
}

describe('UsersService.getProfileCompleteness', () => {
  it('returns complete for individual profile when required fields exist', () => {
    const result = usersService.getProfileCompleteness(makeUser())

    expect(result.isComplete).toBe(true)
    expect(result.missingFields).toEqual([])
  })

  it('returns complete for business profile without first/last name', () => {
    const result = usersService.getProfileCompleteness(
      makeUser({
        firstName: null,
        lastName: null,
        businessName: 'Acme Imports Ltd',
      }),
    )

    expect(result.isComplete).toBe(true)
    expect(result.missingFields).toEqual([])
  })

  it('does not require whatsappNumber for profile completeness', () => {
    const result = usersService.getProfileCompleteness(
      makeUser({ whatsappNumber: null }),
    )

    expect(result.isComplete).toBe(true)
    expect(result.missingFields).toEqual([])
  })

  it('returns missing fields when required fields are absent', () => {
    const result = usersService.getProfileCompleteness(
      makeUser({
        firstName: null,
        lastName: null,
        businessName: null,
        phone: null,
        addressStreet: null,
        addressCity: null,
        addressState: null,
        addressCountry: null,
        addressPostalCode: null,
      }),
    )

    expect(result.isComplete).toBe(false)
    expect(result.missingFields).toEqual([
      'name',
      'phone',
      'addressStreet',
      'addressCity',
      'addressState',
      'addressCountry',
      'addressPostalCode',
    ])
  })
})
