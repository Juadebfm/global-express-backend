import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { appSettings } from '../../drizzle/schema'

const LOGISTICS_SETTINGS_KEY = 'logistics'
const LOGISTICS_SETTINGS_DESCRIPTION =
  'Logistics settings: lane lock, office addresses, and transit notes'

export interface LogisticsLaneSettings {
  originCountry: string
  originCity: string
  destinationCountry: string
  destinationCity: string
  isLocked: boolean
}

export interface LogisticsOfficeSettings {
  nameEn: string
  nameKo: string
  addressEn: string
  addressKo: string
  phone: string | null
}

export interface LogisticsEtaNotes {
  airLeadTimeNote: string
  seaLeadTimeNote: string
}

export interface LogisticsSettings {
  lane: LogisticsLaneSettings
  koreaOffice: LogisticsOfficeSettings
  lagosOffice: LogisticsOfficeSettings
  etaNotes: LogisticsEtaNotes
}

export interface LogisticsSettingsResponse extends LogisticsSettings {
  updatedAt: string | null
}

export interface UpdateLogisticsSettingsInput {
  actorId: string
  lane?: Partial<LogisticsLaneSettings>
  koreaOffice?: Partial<LogisticsOfficeSettings>
  lagosOffice?: Partial<LogisticsOfficeSettings>
  etaNotes?: Partial<LogisticsEtaNotes>
}

const DEFAULT_LOGISTICS_SETTINGS: LogisticsSettings = {
  lane: {
    originCountry: 'South Korea',
    originCity: 'Goyang-si',
    destinationCountry: 'Nigeria',
    destinationCity: 'Lagos',
    isLocked: true,
  },
  koreaOffice: {
    nameEn: 'GLOBAL EXPRESS',
    nameKo: 'GLOBAL \uc775\uc2a4\ud504\ub808\uc2a4',
    addressEn: '76-25 Daehwa-ro, Ilsanseo-gu, Goyang-si, Gyeonggi-do (Bldg. B)',
    addressKo:
      '\uacbd\uae30 \uace0\uc591\uc2dc \uc77c\uc0b0\uc11c\uad6c \ub300\ud654\ub85c 76-25 (B\ub3d9)',
    phone: '+82-10-4710-5920',
  },
  lagosOffice: {
    nameEn: 'GLOBAL EXPRESS Lagos Office',
    nameKo: 'GLOBAL EXPRESS Lagos Office',
    addressEn: '58B Awoniyi Elemo Street, Ajao Estate, Lagos',
    addressKo: '58B Awoniyi Elemo Street, Ajao Estate, Lagos',
    phone: null,
  },
  etaNotes: {
    airLeadTimeNote: 'Weekly departures (timing depends on schedule)',
    seaLeadTimeNote: 'Transit about 3 months after boarding',
  },
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return {}
}

function toNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function toNullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return fallback
}

function normalizeLogisticsSettings(raw: unknown): LogisticsSettings {
  const root = toRecord(raw)
  const lane = toRecord(root.lane)
  const koreaOffice = toRecord(root.koreaOffice)
  const lagosOffice = toRecord(root.lagosOffice)
  const etaNotes = toRecord(root.etaNotes)

  return {
    lane: {
      originCountry: toNonEmptyString(
        lane.originCountry,
        DEFAULT_LOGISTICS_SETTINGS.lane.originCountry,
      ),
      originCity: toNonEmptyString(
        lane.originCity,
        DEFAULT_LOGISTICS_SETTINGS.lane.originCity,
      ),
      destinationCountry: toNonEmptyString(
        lane.destinationCountry,
        DEFAULT_LOGISTICS_SETTINGS.lane.destinationCountry,
      ),
      destinationCity: toNonEmptyString(
        lane.destinationCity,
        DEFAULT_LOGISTICS_SETTINGS.lane.destinationCity,
      ),
      isLocked: toBoolean(lane.isLocked, DEFAULT_LOGISTICS_SETTINGS.lane.isLocked),
    },
    koreaOffice: {
      nameEn: toNonEmptyString(koreaOffice.nameEn, DEFAULT_LOGISTICS_SETTINGS.koreaOffice.nameEn),
      nameKo: toNonEmptyString(koreaOffice.nameKo, DEFAULT_LOGISTICS_SETTINGS.koreaOffice.nameKo),
      addressEn: toNonEmptyString(
        koreaOffice.addressEn,
        DEFAULT_LOGISTICS_SETTINGS.koreaOffice.addressEn,
      ),
      addressKo: toNonEmptyString(
        koreaOffice.addressKo,
        DEFAULT_LOGISTICS_SETTINGS.koreaOffice.addressKo,
      ),
      phone: toNullableString(koreaOffice.phone, DEFAULT_LOGISTICS_SETTINGS.koreaOffice.phone),
    },
    lagosOffice: {
      nameEn: toNonEmptyString(lagosOffice.nameEn, DEFAULT_LOGISTICS_SETTINGS.lagosOffice.nameEn),
      nameKo: toNonEmptyString(lagosOffice.nameKo, DEFAULT_LOGISTICS_SETTINGS.lagosOffice.nameKo),
      addressEn: toNonEmptyString(
        lagosOffice.addressEn,
        DEFAULT_LOGISTICS_SETTINGS.lagosOffice.addressEn,
      ),
      addressKo: toNonEmptyString(
        lagosOffice.addressKo,
        DEFAULT_LOGISTICS_SETTINGS.lagosOffice.addressKo,
      ),
      phone: toNullableString(lagosOffice.phone, DEFAULT_LOGISTICS_SETTINGS.lagosOffice.phone),
    },
    etaNotes: {
      airLeadTimeNote: toNonEmptyString(
        etaNotes.airLeadTimeNote,
        DEFAULT_LOGISTICS_SETTINGS.etaNotes.airLeadTimeNote,
      ),
      seaLeadTimeNote: toNonEmptyString(
        etaNotes.seaLeadTimeNote,
        DEFAULT_LOGISTICS_SETTINGS.etaNotes.seaLeadTimeNote,
      ),
    },
  }
}

function mergeLogisticsSettings(
  current: LogisticsSettings,
  input: UpdateLogisticsSettingsInput,
): LogisticsSettings {
  return {
    lane: {
      originCountry: input.lane?.originCountry ?? current.lane.originCountry,
      originCity: input.lane?.originCity ?? current.lane.originCity,
      destinationCountry:
        input.lane?.destinationCountry ?? current.lane.destinationCountry,
      destinationCity: input.lane?.destinationCity ?? current.lane.destinationCity,
      isLocked: input.lane?.isLocked ?? current.lane.isLocked,
    },
    koreaOffice: {
      nameEn: input.koreaOffice?.nameEn ?? current.koreaOffice.nameEn,
      nameKo: input.koreaOffice?.nameKo ?? current.koreaOffice.nameKo,
      addressEn: input.koreaOffice?.addressEn ?? current.koreaOffice.addressEn,
      addressKo: input.koreaOffice?.addressKo ?? current.koreaOffice.addressKo,
      phone:
        input.koreaOffice?.phone !== undefined
          ? input.koreaOffice.phone
          : current.koreaOffice.phone,
    },
    lagosOffice: {
      nameEn: input.lagosOffice?.nameEn ?? current.lagosOffice.nameEn,
      nameKo: input.lagosOffice?.nameKo ?? current.lagosOffice.nameKo,
      addressEn: input.lagosOffice?.addressEn ?? current.lagosOffice.addressEn,
      addressKo: input.lagosOffice?.addressKo ?? current.lagosOffice.addressKo,
      phone:
        input.lagosOffice?.phone !== undefined
          ? input.lagosOffice.phone
          : current.lagosOffice.phone,
    },
    etaNotes: {
      airLeadTimeNote:
        input.etaNotes?.airLeadTimeNote ?? current.etaNotes.airLeadTimeNote,
      seaLeadTimeNote:
        input.etaNotes?.seaLeadTimeNote ?? current.etaNotes.seaLeadTimeNote,
    },
  }
}

export class SettingsLogisticsService {
  async getLogisticsSettings(): Promise<LogisticsSettingsResponse> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, LOGISTICS_SETTINGS_KEY))
      .limit(1)

    const settings = normalizeLogisticsSettings(row?.value)

    return {
      ...settings,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    }
  }

  async updateLogisticsSettings(
    input: UpdateLogisticsSettingsInput,
  ): Promise<LogisticsSettingsResponse> {
    const current = await this.getLogisticsSettings()
    const nextSettings = mergeLogisticsSettings(current, input)
    const nextSettingsValue = nextSettings as unknown as Record<string, unknown>
    const now = new Date()

    await db
      .insert(appSettings)
      .values({
        key: LOGISTICS_SETTINGS_KEY,
        value: nextSettingsValue,
        description: LOGISTICS_SETTINGS_DESCRIPTION,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: nextSettingsValue,
          description: LOGISTICS_SETTINGS_DESCRIPTION,
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

export const settingsLogisticsService = new SettingsLogisticsService()
