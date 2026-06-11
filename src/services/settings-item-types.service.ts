import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { appSettings } from '../../drizzle/schema'

const ITEM_TYPES_KEY = 'item_types'
const ITEM_TYPES_DESCRIPTION = 'Standard item type categories for warehouse intake package lines'

export interface ItemTypeConfig {
  key: string
  label: string
  isActive: boolean
}

export interface ItemTypeSettingsResponse {
  items: ItemTypeConfig[]
  updatedAt: string | null
}

export interface ItemTypePatchItem {
  key: string
  label?: string
  isActive?: boolean
}

export interface UpdateItemTypeSettingsInput {
  actorId: string
  items?: ItemTypePatchItem[]
  deleteKeys?: string[]
}

export interface ItemTypeSettingsMutationSummary {
  createdKeys: string[]
  updatedKeys: string[]
  deletedKeys: string[]
}

const DEFAULT_ITEM_TYPES: ItemTypeConfig[] = [
  { key: 'electronics', label: 'Electronics & Gadgets', isActive: true },
  { key: 'phones', label: 'Phones & Accessories', isActive: true },
  { key: 'computers', label: 'Computers & Peripherals', isActive: true },
  { key: 'cosmetics', label: 'Cosmetics & Skincare', isActive: true },
  { key: 'clothing', label: 'Clothing & Apparel', isActive: true },
  { key: 'footwear', label: 'Footwear', isActive: true },
  { key: 'hair_beauty', label: 'Hair & Beauty Accessories', isActive: true },
  { key: 'food_grocery', label: 'Food & Groceries', isActive: true },
  { key: 'health_supplements', label: 'Health & Supplements', isActive: true },
  { key: 'auto_parts', label: 'Auto Parts & Accessories', isActive: true },
  { key: 'machinery', label: 'Machinery & Equipment', isActive: true },
  { key: 'industrial_supplies', label: 'Industrial Supplies', isActive: true },
  { key: 'building_materials', label: 'Building Materials', isActive: true },
  { key: 'fabrics_textiles', label: 'Fabrics & Textiles', isActive: true },
  { key: 'household_items', label: 'Household Items & Furniture', isActive: true },
  { key: 'toys_games', label: 'Toys & Games', isActive: true },
  { key: 'medical_devices', label: 'Medical Devices & Supplies', isActive: true },
  { key: 'documents', label: 'Documents', isActive: true },
  { key: 'personal_effects', label: 'Personal Effects', isActive: true },
]

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

function normalizeItem(raw: unknown, fallback?: ItemTypeConfig): ItemTypeConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const key = normalizeKey(r.key ?? fallback?.key)
  if (!key) return null

  return {
    key,
    label:
      typeof r.label === 'string' && r.label.trim()
        ? r.label.trim()
        : (fallback?.label ?? key),
    isActive: typeof r.isActive === 'boolean' ? r.isActive : (fallback?.isActive ?? true),
  }
}

function normalizeItemTypeSettings(raw: unknown): ItemTypeConfig[] {
  const root = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const rawItems = Array.isArray(root.items) ? root.items : []

  if (rawItems.length === 0) return [...DEFAULT_ITEM_TYPES]

  const defaultsByKey = new Map(DEFAULT_ITEM_TYPES.map((item) => [item.key, item]))
  const map = new Map<string, ItemTypeConfig>()

  for (const item of rawItems) {
    const key = normalizeKey((item as Record<string, unknown>).key)
    const normalized = normalizeItem(item, key ? defaultsByKey.get(key) : undefined)
    if (!normalized) continue
    map.set(normalized.key, normalized)
  }

  return [...map.values()]
}

export class SettingsItemTypesService {
  async getItemTypeSettings(params?: {
    includeInactive?: boolean
  }): Promise<ItemTypeSettingsResponse> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, ITEM_TYPES_KEY))
      .limit(1)

    const allItems = normalizeItemTypeSettings(row?.value)
    const items = params?.includeInactive ? allItems : allItems.filter((item) => item.isActive)

    return { items, updatedAt: row ? row.updatedAt.toISOString() : null }
  }

  async updateItemTypeSettings(input: UpdateItemTypeSettingsInput): Promise<{
    summary: ItemTypeSettingsMutationSummary
    settings: ItemTypeSettingsResponse
  }> {
    const current = await this.getItemTypeSettings({ includeInactive: true })
    const nextMap = new Map(current.items.map((item) => [item.key, item]))

    const summary: ItemTypeSettingsMutationSummary = {
      createdKeys: [],
      updatedKeys: [],
      deletedKeys: [],
    }

    for (const patch of input.items ?? []) {
      const key = normalizeKey(patch.key)
      if (!key) continue

      const existing = nextMap.get(key)

      if (!existing && !patch.label) {
        throw new Error(`New item type "${key}" requires a label.`)
      }

      const normalized = normalizeItem({ ...(existing ?? {}), ...patch, key }, existing)
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
      if (!key || !nextMap.has(key)) continue
      nextMap.delete(key)
      summary.deletedKeys.push(key)
    }

    const nextItems = [...nextMap.values()]
    if (nextItems.length === 0) {
      throw new Error('At least one item type must remain configured.')
    }

    const now = new Date()
    const value = { items: nextItems } as unknown as Record<string, unknown>

    await db
      .insert(appSettings)
      .values({
        key: ITEM_TYPES_KEY,
        value,
        description: ITEM_TYPES_DESCRIPTION,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, description: ITEM_TYPES_DESCRIPTION, updatedBy: input.actorId, updatedAt: now },
      })

    return { summary, settings: { items: nextItems, updatedAt: now.toISOString() } }
  }
}

export const settingsItemTypesService = new SettingsItemTypesService()
