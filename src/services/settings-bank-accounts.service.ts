import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { appSettings } from '../../drizzle/schema'

const SETTINGS_KEY = 'bank_accounts'

export interface BankAccount {
  currency: string
  accountNumber: string
}

export interface Bank {
  bankName: string
  accounts: BankAccount[]
}

export interface BankAccountSettings {
  beneficiaryName: string
  banks: Bank[]
}

export interface BankAccountSettingsResponse extends BankAccountSettings {
  updatedAt: string | null
}

const DEFAULT_BANK_ACCOUNT_SETTINGS: BankAccountSettings = {
  beneficiaryName: 'Global Express Luggage Company',
  banks: [
    {
      bankName: 'First Bank',
      accounts: [
        { currency: 'NGN', accountNumber: '2032266580' },
        { currency: 'USD', accountNumber: '2032276680' },
      ],
    },
    {
      bankName: 'UBA',
      accounts: [
        { currency: 'NGN', accountNumber: '1020413207' },
        { currency: 'USD', accountNumber: '3002331394' },
      ],
    },
    {
      bankName: 'GT Bank',
      accounts: [
        { currency: 'NGN', accountNumber: '0717053413' },
        { currency: 'USD', accountNumber: '0717053420' },
      ],
    },
    {
      bankName: 'Zenith Bank',
      accounts: [
        { currency: 'NGN', accountNumber: '1224748578' },
        { currency: 'USD', accountNumber: '5073092367' },
      ],
    },
  ],
}

async function getRow() {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SETTINGS_KEY))
    .limit(1)
  return row ?? null
}

async function getBankAccountSettings(): Promise<BankAccountSettingsResponse> {
  const row = await getRow()
  const value = (row?.value ?? DEFAULT_BANK_ACCOUNT_SETTINGS) as unknown as BankAccountSettings
  return {
    ...value,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  }
}

async function updateBankAccountSettings(input: {
  actorId: string
  beneficiaryName?: string
  banks?: Bank[]
}): Promise<BankAccountSettingsResponse> {
  const current = await getBankAccountSettings()

  const next: BankAccountSettings = {
    beneficiaryName: input.beneficiaryName ?? current.beneficiaryName,
    banks: input.banks ?? current.banks,
  }

  const [row] = await db
    .insert(appSettings)
    .values({
      key: SETTINGS_KEY,
      value: next as unknown as Record<string, unknown>,
      description: 'Bank account details shown on the payment page',
      updatedBy: input.actorId,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: next as unknown as Record<string, unknown>,
        updatedBy: input.actorId,
        updatedAt: new Date(),
      },
    })
    .returning()

  return {
    ...next,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

export const settingsBankAccountsService = {
  getBankAccountSettings,
  updateBankAccountSettings,
}
