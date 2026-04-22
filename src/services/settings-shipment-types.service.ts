import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { appSettings } from '../../drizzle/schema'

const SHIPMENT_TYPES_SETTINGS_KEY = 'shipment_types'
const SHIPMENT_TYPES_SETTINGS_DESCRIPTION =
  'Global shipment type options/config used across public and internal experiences'

export type ShipmentEstimatorMode = 'CALCULATED' | 'INTAKE'
export type CoreShipmentType = 'air' | 'ocean' | 'd2d'

export interface ShipmentTypeConfig {
  key: string
  label: string
  isActive: boolean
  coreShipmentType: CoreShipmentType
  estimatorMode: ShipmentEstimatorMode
  infoTitle: string | null
  infoDescription: string | null
  submitEndpoint: string | null
  requiredFields: string[]
  nextStep: string | null
}

export interface ShipmentTypeSettingsResponse {
  items: ShipmentTypeConfig[]
  updatedAt: string | null
}

export interface ShipmentTypePatchItem {
  key: string
  label?: string
  isActive?: boolean
  coreShipmentType?: CoreShipmentType
  estimatorMode?: ShipmentEstimatorMode
  infoTitle?: string | null
  infoDescription?: string | null
  submitEndpoint?: string | null
  requiredFields?: string[]
  nextStep?: string | null
}

export interface UpdateShipmentTypeSettingsInput {
  actorId: string
  items?: ShipmentTypePatchItem[]
  deleteKeys?: string[]
}

export interface ShipmentTypeSettingsMutationSummary {
  createdKeys: string[]
  updatedKeys: string[]
  deletedKeys: string[]
}

const DEFAULT_D2D_REQUIRED_FIELDS = [
  'fullName',
  'email',
  'phone',
  'city',
  'country',
  'goodsDescription',
  'deliveryPhone',
  'deliveryAddressLine1',
  'consentAcknowledgement',
  'wantsAccount',
]

const DEFAULT_SHIPMENT_TYPES: ShipmentTypeConfig[] = [
  {
    key: 'air',
    label: 'Air',
    isActive: true,
    coreShipmentType: 'air',
    estimatorMode: 'CALCULATED',
    infoTitle: null,
    infoDescription: null,
    submitEndpoint: null,
    requiredFields: [],
    nextStep: null,
  },
  {
    key: 'ocean',
    label: 'Ocean',
    isActive: true,
    coreShipmentType: 'ocean',
    estimatorMode: 'CALCULATED',
    infoTitle: null,
    infoDescription: null,
    submitEndpoint: null,
    requiredFields: [],
    nextStep: null,
  },
  {
    key: 'd2d',
    label: 'Door-to-Door (D2D)',
    isActive: true,
    coreShipmentType: 'd2d',
    estimatorMode: 'INTAKE',
    infoTitle: 'Door-to-Door (D2D) Shipment',
    infoDescription:
      'D2D includes origin handling, freight movement, and delivery coordination to your destination. Submit your details so our team can review and revert with pricing and movement plan.',
    submitEndpoint: '/api/v1/public/d2d/intake',
    requiredFields: DEFAULT_D2D_REQUIRED_FIELDS,
    nextStep:
      'Submit your D2D intake details and our team will contact you with a tailored quote and next actions.',
  },
]

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  return {}
}

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function toNullableTrimmedString(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : fallback
  }
  return fallback
}

function toRequiredTrimmedString(value: unknown, fallback: string): string {
  const normalized = toNullableTrimmedString(value, fallback)
  return normalized ?? fallback
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function normalizeEstimatorMode(value: unknown, fallback: ShipmentEstimatorMode): ShipmentEstimatorMode {
  if (value === 'CALCULATED' || value === 'INTAKE') return value
  return fallback
}

function normalizeCoreShipmentType(value: unknown, fallback: CoreShipmentType): CoreShipmentType {
  if (value === 'air' || value === 'ocean' || value === 'd2d') return value
  return fallback
}

function normalizeRequiredFields(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback
}

function mergeRequiredFields(base: string[], enforced: string[]): string[] {
  return Array.from(new Set([...base, ...enforced]))
}

function assertValidTypeKey(key: string) {
  if (!/^[a-z0-9_-]+$/.test(key)) {
    throw new Error('shipment type key must contain only lowercase letters, numbers, underscore, or hyphen')
  }
}

function validateShipmentTypeConfig(config: ShipmentTypeConfig) {
  assertValidTypeKey(config.key)

  if (config.estimatorMode === 'CALCULATED' && config.coreShipmentType === 'd2d') {
    throw new Error(
      `Shipment type "${config.key}" is invalid: CALCULATED mode supports only coreShipmentType air or ocean.`,
    )
  }

  if (config.estimatorMode === 'INTAKE') {
    if (!config.infoTitle?.trim()) {
      throw new Error(`Shipment type "${config.key}" requires infoTitle for INTAKE mode.`)
    }
    if (!config.infoDescription?.trim()) {
      throw new Error(`Shipment type "${config.key}" requires infoDescription for INTAKE mode.`)
    }
    if (!config.submitEndpoint?.trim()) {
      throw new Error(`Shipment type "${config.key}" requires submitEndpoint for INTAKE mode.`)
    }
    if (!config.nextStep?.trim()) {
      throw new Error(`Shipment type "${config.key}" requires nextStep for INTAKE mode.`)
    }
    if ((config.requiredFields ?? []).length === 0) {
      throw new Error(`Shipment type "${config.key}" requires at least one requiredFields entry for INTAKE mode.`)
    }
  }
}

function assertCreatePayloadComplete(patch: ShipmentTypePatchItem) {
  const missing: string[] = []
  if (patch.label === undefined) missing.push('label')
  if (patch.isActive === undefined) missing.push('isActive')
  if (patch.coreShipmentType === undefined) missing.push('coreShipmentType')
  if (patch.estimatorMode === undefined) missing.push('estimatorMode')

  if ((patch.estimatorMode ?? null) === 'INTAKE') {
    if (patch.infoTitle === undefined) missing.push('infoTitle')
    if (patch.infoDescription === undefined) missing.push('infoDescription')
    if (patch.submitEndpoint === undefined) missing.push('submitEndpoint')
    if (patch.requiredFields === undefined) missing.push('requiredFields')
    if (patch.nextStep === undefined) missing.push('nextStep')
  }

  if (missing.length > 0) {
    throw new Error(
      `New shipment type "${patch.key}" is missing required settings: ${missing.join(', ')}`,
    )
  }
}

function normalizeItem(raw: unknown, fallback?: ShipmentTypeConfig): ShipmentTypeConfig | null {
  const root = toRecord(raw)
  const key = normalizeKey(root.key ?? fallback?.key)
  if (!key) return null

  const config: ShipmentTypeConfig = {
    key,
    label: toRequiredTrimmedString(root.label, fallback?.label ?? key.toUpperCase()),
    isActive: toBoolean(root.isActive, fallback?.isActive ?? true),
    coreShipmentType: normalizeCoreShipmentType(
      root.coreShipmentType,
      fallback?.coreShipmentType ?? 'air',
    ),
    estimatorMode: normalizeEstimatorMode(root.estimatorMode, fallback?.estimatorMode ?? 'INTAKE'),
    infoTitle: toNullableTrimmedString(root.infoTitle, fallback?.infoTitle ?? null),
    infoDescription: toNullableTrimmedString(
      root.infoDescription,
      fallback?.infoDescription ?? null,
    ),
    submitEndpoint: toNullableTrimmedString(root.submitEndpoint, fallback?.submitEndpoint ?? null),
    requiredFields: normalizeRequiredFields(root.requiredFields, fallback?.requiredFields ?? []),
    nextStep: toNullableTrimmedString(root.nextStep, fallback?.nextStep ?? null),
  }

  if (config.key === 'd2d' && config.estimatorMode === 'INTAKE') {
    config.requiredFields = mergeRequiredFields(config.requiredFields, DEFAULT_D2D_REQUIRED_FIELDS)
  }

  validateShipmentTypeConfig(config)
  return config
}

function normalizeShipmentTypeSettings(raw: unknown): ShipmentTypeConfig[] {
  const root = toRecord(raw)
  const defaultsByKey = new Map(DEFAULT_SHIPMENT_TYPES.map((item) => [item.key, item]))

  const rawItems = Array.isArray(root.items)
    ? root.items
    : Array.isArray(raw)
      ? raw
      : []

  if (rawItems.length === 0) {
    return [...DEFAULT_SHIPMENT_TYPES]
  }

  const map = new Map<string, ShipmentTypeConfig>()

  for (const item of rawItems) {
    const key = normalizeKey(toRecord(item).key)
    const normalized = normalizeItem(item, key ? defaultsByKey.get(key) : undefined)
    if (!normalized) continue
    map.set(normalized.key, normalized)
  }

  return [...map.values()]
}

export class SettingsShipmentTypesService {
  async getShipmentTypeSettings(params?: {
    includeInactive?: boolean
  }): Promise<ShipmentTypeSettingsResponse> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SHIPMENT_TYPES_SETTINGS_KEY))
      .limit(1)

    const allItems = normalizeShipmentTypeSettings(row?.value)
    const items = params?.includeInactive ? allItems : allItems.filter((item) => item.isActive)

    return {
      items,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    }
  }

  async getActiveShipmentTypeByKey(key: string): Promise<ShipmentTypeConfig | null> {
    const settings = await this.getShipmentTypeSettings({ includeInactive: false })
    return settings.items.find((item) => item.key === key.trim().toLowerCase()) ?? null
  }

  async updateShipmentTypeSettings(
    input: UpdateShipmentTypeSettingsInput,
  ): Promise<{
    summary: ShipmentTypeSettingsMutationSummary
    settings: ShipmentTypeSettingsResponse
  }> {
    const current = await this.getShipmentTypeSettings({ includeInactive: true })
    const nextMap = new Map(current.items.map((item) => [item.key, item]))

    const summary: ShipmentTypeSettingsMutationSummary = {
      createdKeys: [],
      updatedKeys: [],
      deletedKeys: [],
    }

    for (const patch of input.items ?? []) {
      const key = normalizeKey(patch.key)
      if (!key) continue

      const existing = nextMap.get(key)
      if (!existing) {
        assertCreatePayloadComplete({ ...patch, key })
      }

      const normalized = normalizeItem(
        {
          ...(existing ?? {}),
          ...patch,
          key,
        },
        existing ?? DEFAULT_SHIPMENT_TYPES.find((item) => item.key === key),
      )

      if (!normalized) continue

      nextMap.set(key, normalized)
      if (existing) {
        summary.updatedKeys.push(key)
      } else {
        summary.createdKeys.push(key)
      }
    }

    for (const rawKey of input.deleteKeys ?? []) {
      const key = normalizeKey(rawKey)
      if (!key) continue
      if (!nextMap.has(key)) continue
      nextMap.delete(key)
      summary.deletedKeys.push(key)
    }

    const nextItems = [...nextMap.values()]
    if (nextItems.length === 0) {
      throw new Error('At least one shipment type must remain configured.')
    }

    const now = new Date()
    const value = { items: nextItems } as unknown as Record<string, unknown>

    await db
      .insert(appSettings)
      .values({
        key: SHIPMENT_TYPES_SETTINGS_KEY,
        value,
        description: SHIPMENT_TYPES_SETTINGS_DESCRIPTION,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value,
          description: SHIPMENT_TYPES_SETTINGS_DESCRIPTION,
          updatedBy: input.actorId,
          updatedAt: now,
        },
      })

    return {
      summary,
      settings: {
        items: nextItems,
        updatedAt: now.toISOString(),
      },
    }
  }
}

export const settingsShipmentTypesService = new SettingsShipmentTypesService()
