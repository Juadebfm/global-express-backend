import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserRole } from '../../src/types/enums'

const {
  selectLimit,
  insertValues,
  sendPasswordResetOtpEmail,
  mockDb,
} = vi.hoisted(() => {
  const selectLimit = vi.fn()
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))

  const insertValues = vi.fn()
  const insert = vi.fn(() => ({ values: insertValues }))

  return {
    selectLimit,
    insertValues,
    sendPasswordResetOtpEmail: vi.fn(),
    mockDb: {
      select,
      insert,
      update: vi.fn(),
    },
  }
})

vi.mock('../../src/config/db', () => ({
  db: mockDb,
}))

vi.mock('../../src/notifications/email', () => ({
  sendPasswordResetOtpEmail,
}))

vi.mock('../../src/services/internal-auth.service', () => ({
  internalAuthService: {
    updatePassword: vi.fn(),
  },
}))

import { PasswordResetService } from '../../src/services/password-reset.service'

describe('PasswordResetService.sendOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectLimit.mockReset()
    insertValues.mockReset().mockResolvedValue(undefined)
    sendPasswordResetOtpEmail.mockReset().mockResolvedValue(undefined)
  })

  it('uses the configured static OTP for allowlisted superadmin emails without sending email', async () => {
    selectLimit.mockResolvedValue([
      {
        passwordHash: 'hashed-password',
        isActive: true,
        role: UserRole.SUPER_ADMIN,
      },
    ])

    const service = new PasswordResetService()
    await service.sendOtp('Hazyom@gmail.com')

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'hazyom@gmail.com',
        otp: '4321',
      }),
    )
    expect(sendPasswordResetOtpEmail).not.toHaveBeenCalled()
  })

  it('keeps the emailed OTP flow for superadmins outside the allowlist', async () => {
    selectLimit.mockResolvedValue([
      {
        passwordHash: 'hashed-password',
        isActive: true,
        role: UserRole.SUPER_ADMIN,
      },
    ])
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const service = new PasswordResetService()
    await service.sendOtp('juadebgabriel@gmail.com')

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'juadebgabriel@gmail.com',
        otp: '1000',
      }),
    )
    expect(sendPasswordResetOtpEmail).toHaveBeenCalledWith({
      to: 'juadebgabriel@gmail.com',
      otp: '1000',
    })

    randomSpy.mockRestore()
  })

  it('does not enable the static OTP for non-superadmin accounts', async () => {
    selectLimit.mockResolvedValue([
      {
        passwordHash: 'hashed-password',
        isActive: true,
        role: UserRole.STAFF,
      },
    ])
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const service = new PasswordResetService()
    await service.sendOtp('staff@example.com')

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'staff@example.com',
        otp: '1000',
      }),
    )
    expect(sendPasswordResetOtpEmail).toHaveBeenCalledWith({
      to: 'staff@example.com',
      otp: '1000',
    })

    randomSpy.mockRestore()
  })
})
