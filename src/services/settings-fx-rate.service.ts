import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { appSettings } from '../../drizzle/schema'

const FX_RATE_SETTINGS_KEY = 'fx_rate'
const FX_RATE_SETTINGS_DESCRIPTION =
  'FX settings for USD to NGN conversion (live or manual mode)'

export type FxRateMode = 'live' | 'manual'

export interface FxRateSettings {
  currencyPair: 'USD_NGN'
  mode: FxRateMode
  manualRate: number | null
  updatedAt: string | null
}

export interface UpdateFxRateSettingsInput {
  actorId: string
  mode?: FxRateMode
  manualRate?: number | null
}

const DEFAULT_FX_RATE_SETTINGS: Omit<FxRateSettings, 'updatedAt'> = {
  currencyPair: 'USD_NGN',
  mode: 'live',
  manualRate: null,
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return {}
}

function toFxMode(value: unknown, fallback: FxRateMode): FxRateMode {
  if (value === 'live' || value === 'manual') {
    return value
  }
  return fallback
}

function toPositiveNumberOrNull(
  value: unknown,
  fallback: number | null,
): number | null {
  if (value === null) {
    return null
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return fallback
}

function normalizeFxRateSettings(raw: unknown): Omit<FxRateSettings, 'updatedAt'> {
  const root = toRecord(raw)

  return {
    currencyPair: 'USD_NGN',
    mode: toFxMode(root.mode, DEFAULT_FX_RATE_SETTINGS.mode),
    manualRate: toPositiveNumberOrNull(
      root.manualRate,
      DEFAULT_FX_RATE_SETTINGS.manualRate,
    ),
  }
}

export class SettingsFxRateService {
  async getFxRateSettings(): Promise<FxRateSettings> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, FX_RATE_SETTINGS_KEY))
      .limit(1)

    const settings = normalizeFxRateSettings(row?.value)

    return {
      ...settings,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    }
  }

  async updateFxRateSettings(
    input: UpdateFxRateSettingsInput,
  ): Promise<FxRateSettings> {
    const current = await this.getFxRateSettings()

    const nextMode = input.mode ?? current.mode
    const nextManualRate =
      input.manualRate !== undefined ? input.manualRate : current.manualRate

    if (nextMode === 'manual' && (nextManualRate === null || nextManualRate <= 0)) {
      throw new Error('manualRate must be provided and greater than 0 when mode is manual')
    }

    const nextSettings: Omit<FxRateSettings, 'updatedAt'> = {
      currencyPair: 'USD_NGN',
      mode: nextMode,
      manualRate: nextManualRate,
    }

    const now = new Date()

    await db
      .insert(appSettings)
      .values({
        key: FX_RATE_SETTINGS_KEY,
        value: nextSettings,
        description: FX_RATE_SETTINGS_DESCRIPTION,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: nextSettings,
          description: FX_RATE_SETTINGS_DESCRIPTION,
          updatedBy: input.actorId,
          updatedAt: now,
        },
      })

    return {
      ...nextSettings,
      updatedAt: now.toISOString(),
    }
  }
}

export const settingsFxRateService = new SettingsFxRateService()
