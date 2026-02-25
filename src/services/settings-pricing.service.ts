import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { customerPricingOverrides, pricingRules } from '../../drizzle/schema'
import { TransportMode } from '../types/enums'

export interface PricingRuleUpsertInput {
  id?: string
  name: string
  mode: TransportMode
  minWeightKg?: number
  maxWeightKg?: number
  rateUsdPerKg?: number
  flatRateUsdPerCbm?: number
  isActive?: boolean
  effectiveFrom?: Date
  effectiveTo?: Date
}

export interface CustomerPricingOverrideUpsertInput {
  id?: string
  customerId: string
  mode: TransportMode
  minWeightKg?: number
  maxWeightKg?: number
  rateUsdPerKg?: number
  flatRateUsdPerCbm?: number
  startsAt?: Date
  endsAt?: Date
  isActive?: boolean
  notes?: string
}

export interface UpdatePricingSettingsInput {
  actorId: string
  defaultRules?: PricingRuleUpsertInput[]
  customerOverrides?: CustomerPricingOverrideUpsertInput[]
  deleteDefaultRuleIds?: string[]
  deleteCustomerOverrideIds?: string[]
}

export interface PricingSettingsListParams {
  mode?: TransportMode
  customerId?: string
  includeInactive?: boolean
}

export interface PricingSettingsMutationSummary {
  createdDefaultRuleIds: string[]
  updatedDefaultRuleIds: string[]
  deletedDefaultRuleIds: string[]
  createdCustomerOverrideIds: string[]
  updatedCustomerOverrideIds: string[]
  deletedCustomerOverrideIds: string[]
}

function toNumericString(value: number | undefined): string | null {
  if (value === undefined) return null
  return value.toString()
}

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export class SettingsPricingService {
  async listPricingSettings(params: PricingSettingsListParams = {}) {
    const includeInactive = params.includeInactive ?? false

    const defaultRulesWhere = and(
      params.mode ? eq(pricingRules.mode, params.mode) : undefined,
      includeInactive ? undefined : eq(pricingRules.isActive, true),
    )

    const customerOverridesWhere = and(
      params.customerId
        ? eq(customerPricingOverrides.customerId, params.customerId)
        : undefined,
      params.mode ? eq(customerPricingOverrides.mode, params.mode) : undefined,
      includeInactive ? undefined : eq(customerPricingOverrides.isActive, true),
    )

    const [defaultRulesRows, customerOverrideRows] = await Promise.all([
      db
        .select()
        .from(pricingRules)
        .where(defaultRulesWhere)
        .orderBy(desc(pricingRules.updatedAt), desc(pricingRules.createdAt)),
      db
        .select()
        .from(customerPricingOverrides)
        .where(customerOverridesWhere)
        .orderBy(
          desc(customerPricingOverrides.updatedAt),
          desc(customerPricingOverrides.createdAt),
        ),
    ])

    return {
      defaultRules: defaultRulesRows.map((row) => ({
        ...row,
        effectiveFrom: toIsoOrNull(row.effectiveFrom),
        effectiveTo: toIsoOrNull(row.effectiveTo),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      customerOverrides: customerOverrideRows.map((row) => ({
        ...row,
        startsAt: toIsoOrNull(row.startsAt),
        endsAt: toIsoOrNull(row.endsAt),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    }
  }

  async updatePricingSettings(
    input: UpdatePricingSettingsInput,
  ): Promise<PricingSettingsMutationSummary> {
    const summary: PricingSettingsMutationSummary = {
      createdDefaultRuleIds: [],
      updatedDefaultRuleIds: [],
      deletedDefaultRuleIds: [],
      createdCustomerOverrideIds: [],
      updatedCustomerOverrideIds: [],
      deletedCustomerOverrideIds: [],
    }

    await db.transaction(async (tx) => {
      if (input.defaultRules) {
        for (const rule of input.defaultRules) {
          if (rule.id) {
            const [updated] = await tx
              .update(pricingRules)
              .set({
                name: rule.name,
                mode: rule.mode,
                minWeightKg: toNumericString(rule.minWeightKg),
                maxWeightKg: toNumericString(rule.maxWeightKg),
                rateUsdPerKg: toNumericString(rule.rateUsdPerKg),
                flatRateUsdPerCbm: toNumericString(rule.flatRateUsdPerCbm),
                isActive: rule.isActive ?? true,
                effectiveFrom: rule.effectiveFrom ?? null,
                effectiveTo: rule.effectiveTo ?? null,
                updatedBy: input.actorId,
                updatedAt: new Date(),
              })
              .where(eq(pricingRules.id, rule.id))
              .returning({ id: pricingRules.id })

            if (!updated) {
              throw new Error(`Pricing rule not found: ${rule.id}`)
            }

            summary.updatedDefaultRuleIds.push(updated.id)
          } else {
            const [created] = await tx
              .insert(pricingRules)
              .values({
                name: rule.name,
                mode: rule.mode,
                minWeightKg: toNumericString(rule.minWeightKg),
                maxWeightKg: toNumericString(rule.maxWeightKg),
                rateUsdPerKg: toNumericString(rule.rateUsdPerKg),
                flatRateUsdPerCbm: toNumericString(rule.flatRateUsdPerCbm),
                isActive: rule.isActive ?? true,
                effectiveFrom: rule.effectiveFrom ?? null,
                effectiveTo: rule.effectiveTo ?? null,
                createdBy: input.actorId,
                updatedBy: input.actorId,
              })
              .returning({ id: pricingRules.id })

            summary.createdDefaultRuleIds.push(created.id)
          }
        }
      }

      if (input.customerOverrides) {
        for (const override of input.customerOverrides) {
          if (override.id) {
            const [updated] = await tx
              .update(customerPricingOverrides)
              .set({
                customerId: override.customerId,
                mode: override.mode,
                minWeightKg: toNumericString(override.minWeightKg),
                maxWeightKg: toNumericString(override.maxWeightKg),
                rateUsdPerKg: toNumericString(override.rateUsdPerKg),
                flatRateUsdPerCbm: toNumericString(override.flatRateUsdPerCbm),
                startsAt: override.startsAt ?? null,
                endsAt: override.endsAt ?? null,
                isActive: override.isActive ?? true,
                notes: override.notes ?? null,
                updatedBy: input.actorId,
                updatedAt: new Date(),
              })
              .where(eq(customerPricingOverrides.id, override.id))
              .returning({ id: customerPricingOverrides.id })

            if (!updated) {
              throw new Error(`Customer pricing override not found: ${override.id}`)
            }

            summary.updatedCustomerOverrideIds.push(updated.id)
          } else {
            const [created] = await tx
              .insert(customerPricingOverrides)
              .values({
                customerId: override.customerId,
                mode: override.mode,
                minWeightKg: toNumericString(override.minWeightKg),
                maxWeightKg: toNumericString(override.maxWeightKg),
                rateUsdPerKg: toNumericString(override.rateUsdPerKg),
                flatRateUsdPerCbm: toNumericString(override.flatRateUsdPerCbm),
                startsAt: override.startsAt ?? null,
                endsAt: override.endsAt ?? null,
                isActive: override.isActive ?? true,
                notes: override.notes ?? null,
                createdBy: input.actorId,
                updatedBy: input.actorId,
              })
              .returning({ id: customerPricingOverrides.id })

            summary.createdCustomerOverrideIds.push(created.id)
          }
        }
      }

      if (input.deleteDefaultRuleIds && input.deleteDefaultRuleIds.length > 0) {
        const deleted = await tx
          .delete(pricingRules)
          .where(inArray(pricingRules.id, input.deleteDefaultRuleIds))
          .returning({ id: pricingRules.id })

        summary.deletedDefaultRuleIds.push(...deleted.map((row) => row.id))
      }

      if (
        input.deleteCustomerOverrideIds &&
        input.deleteCustomerOverrideIds.length > 0
      ) {
        const deleted = await tx
          .delete(customerPricingOverrides)
          .where(
            inArray(customerPricingOverrides.id, input.deleteCustomerOverrideIds),
          )
          .returning({ id: customerPricingOverrides.id })

        summary.deletedCustomerOverrideIds.push(...deleted.map((row) => row.id))
      }
    })

    return summary
  }
}

export const settingsPricingService = new SettingsPricingService()
