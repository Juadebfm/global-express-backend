import type { FastifyReply, FastifyRequest } from 'fastify'
import { settingsPricingService } from '../services/settings-pricing.service'
import { settingsRestrictedGoodsService } from '../services/settings-restricted-goods.service'
import {
  settingsLogisticsService,
  type LogisticsEtaNotes,
  type LogisticsLaneSettings,
  type LogisticsOfficeSettings,
} from '../services/settings-logistics.service'
import {
  settingsFxRateService,
  type FxRateMode,
} from '../services/settings-fx-rate.service'
import {
  settingsTemplatesService,
  type NotificationTemplateChannel,
} from '../services/settings-templates.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import { PreferredLanguage, TransportMode, UserRole } from '../types/enums'

export const settingsController = {
  async getLogistics(_request: FastifyRequest, reply: FastifyReply) {
    const data = await settingsLogisticsService.getLogisticsSettings()
    return reply.send(successResponse(data))
  },

  async updateLogistics(
    request: FastifyRequest<{
      Body: {
        lane?: Partial<LogisticsLaneSettings>
        koreaOffice?: Partial<LogisticsOfficeSettings>
        lagosOffice?: Partial<LogisticsOfficeSettings>
        etaNotes?: Partial<LogisticsEtaNotes>
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const hasOfficeUpdate =
        request.body.koreaOffice !== undefined || request.body.lagosOffice !== undefined

      if (hasOfficeUpdate && request.user.role !== UserRole.SUPERADMIN) {
        return reply.code(403).send({
          success: false,
          message: 'Only superadmin can update office address settings',
        })
      }

      const data = await settingsLogisticsService.updateLogisticsSettings({
        actorId: request.user.id,
        lane: request.body.lane,
        koreaOffice: request.body.koreaOffice,
        lagosOffice: request.body.lagosOffice,
        etaNotes: request.body.etaNotes,
      })

      const updatedSections = [
        request.body.lane ? 'lane' : null,
        request.body.koreaOffice ? 'koreaOffice' : null,
        request.body.lagosOffice ? 'lagosOffice' : null,
        request.body.etaNotes ? 'etaNotes' : null,
      ].filter((section): section is string => section !== null)

      await createAuditLog({
        userId: request.user.id,
        action: 'Updated logistics settings',
        resourceType: 'app_settings',
        resourceId: 'logistics',
        request,
        metadata: {
          updatedSections,
        },
      })

      return reply.send(successResponse(data))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update logistics settings'
      return reply.code(400).send({ success: false, message })
    }
  },

  async getFxRate(_request: FastifyRequest, reply: FastifyReply) {
    const data = await settingsFxRateService.getFxRateSettings()
    return reply.send(successResponse(data))
  },

  async updateFxRate(
    request: FastifyRequest<{
      Body: {
        mode?: FxRateMode
        manualRate?: number | null
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const data = await settingsFxRateService.updateFxRateSettings({
        actorId: request.user.id,
        mode: request.body.mode,
        manualRate: request.body.manualRate,
      })

      const updatedFields = [
        request.body.mode !== undefined ? 'mode' : null,
        request.body.manualRate !== undefined ? 'manualRate' : null,
      ].filter((field): field is string => field !== null)

      await createAuditLog({
        userId: request.user.id,
        action: 'Updated FX rate settings',
        resourceType: 'app_settings',
        resourceId: 'fx_rate',
        request,
        metadata: {
          updatedFields,
        },
      })

      return reply.send(successResponse(data))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update FX rate settings'
      return reply.code(400).send({ success: false, message })
    }
  },

  async listTemplates(
    request: FastifyRequest<{
      Querystring: {
        templateKey?: string
        locale?: PreferredLanguage
        channel?: NotificationTemplateChannel
        includeInactive?: boolean
      }
    }>,
    reply: FastifyReply,
  ) {
    const data = await settingsTemplatesService.listTemplates({
      templateKey: request.query.templateKey,
      locale: request.query.locale,
      channel: request.query.channel,
      includeInactive: request.query.includeInactive,
    })

    return reply.send(successResponse(data))
  },

  async updateTemplate(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        templateKey?: string
        locale?: PreferredLanguage
        channel?: NotificationTemplateChannel
        subject?: string | null
        body?: string
        isActive?: boolean
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const data = await settingsTemplatesService.updateTemplate({
        id: request.params.id,
        actorId: request.user.id,
        templateKey: request.body.templateKey,
        locale: request.body.locale,
        channel: request.body.channel,
        subject: request.body.subject,
        body: request.body.body,
        isActive: request.body.isActive,
      })

      const updatedFields = [
        request.body.templateKey !== undefined ? 'templateKey' : null,
        request.body.locale !== undefined ? 'locale' : null,
        request.body.channel !== undefined ? 'channel' : null,
        request.body.subject !== undefined ? 'subject' : null,
        request.body.body !== undefined ? 'body' : null,
        request.body.isActive !== undefined ? 'isActive' : null,
      ].filter((field): field is string => field !== null)

      await createAuditLog({
        userId: request.user.id,
        action: `Updated notification template ${request.params.id}`,
        resourceType: 'notification_template',
        resourceId: request.params.id,
        request,
        metadata: {
          updatedFields,
        },
      })

      return reply.send(successResponse(data))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to update notification template'
      return reply.code(400).send({ success: false, message })
    }
  },

  async listPricing(
    request: FastifyRequest<{
      Querystring: {
        mode?: TransportMode
        customerId?: string
        includeInactive?: boolean
      }
    }>,
    reply: FastifyReply,
  ) {
    const data = await settingsPricingService.listPricingSettings({
      mode: request.query.mode,
      customerId: request.query.customerId,
      includeInactive: request.query.includeInactive,
    })

    return reply.send(successResponse(data))
  },

  async updatePricing(
    request: FastifyRequest<{
      Body: {
        defaultRules?: Array<{
          id?: string
          name: string
          mode: TransportMode
          minWeightKg?: number
          maxWeightKg?: number
          rateUsdPerKg?: number
          flatRateUsdPerCbm?: number
          isActive?: boolean
          effectiveFrom?: string
          effectiveTo?: string
        }>
        customerOverrides?: Array<{
          id?: string
          customerId: string
          mode: TransportMode
          minWeightKg?: number
          maxWeightKg?: number
          rateUsdPerKg?: number
          flatRateUsdPerCbm?: number
          startsAt?: string
          endsAt?: string
          isActive?: boolean
          notes?: string
        }>
        deleteDefaultRuleIds?: string[]
        deleteCustomerOverrideIds?: string[]
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const summary = await settingsPricingService.updatePricingSettings({
        actorId: request.user.id,
        defaultRules: request.body.defaultRules?.map((rule) => ({
          ...rule,
          effectiveFrom: rule.effectiveFrom ? new Date(rule.effectiveFrom) : undefined,
          effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo) : undefined,
        })),
        customerOverrides: request.body.customerOverrides?.map((override) => ({
          ...override,
          startsAt: override.startsAt ? new Date(override.startsAt) : undefined,
          endsAt: override.endsAt ? new Date(override.endsAt) : undefined,
        })),
        deleteDefaultRuleIds: request.body.deleteDefaultRuleIds,
        deleteCustomerOverrideIds: request.body.deleteCustomerOverrideIds,
      })

      const auditEntries: Array<{
        action: string
        resourceType: string
        resourceId: string
        metadata?: Record<string, unknown>
      }> = []

      for (const id of summary.createdDefaultRuleIds) {
        auditEntries.push({
          action: `Created default pricing rule ${id}`,
          resourceType: 'pricing_rule',
          resourceId: id,
        })
      }
      for (const id of summary.updatedDefaultRuleIds) {
        auditEntries.push({
          action: `Updated default pricing rule ${id}`,
          resourceType: 'pricing_rule',
          resourceId: id,
        })
      }
      for (const id of summary.deletedDefaultRuleIds) {
        auditEntries.push({
          action: `Deleted default pricing rule ${id}`,
          resourceType: 'pricing_rule',
          resourceId: id,
        })
      }
      for (const id of summary.createdCustomerOverrideIds) {
        auditEntries.push({
          action: `Created customer pricing override ${id}`,
          resourceType: 'customer_pricing_override',
          resourceId: id,
        })
      }
      for (const id of summary.updatedCustomerOverrideIds) {
        auditEntries.push({
          action: `Updated customer pricing override ${id}`,
          resourceType: 'customer_pricing_override',
          resourceId: id,
        })
      }
      for (const id of summary.deletedCustomerOverrideIds) {
        auditEntries.push({
          action: `Deleted customer pricing override ${id}`,
          resourceType: 'customer_pricing_override',
          resourceId: id,
        })
      }

      await Promise.all(
        auditEntries.map((entry) =>
          createAuditLog({
            userId: request.user.id,
            action: entry.action,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            request,
            metadata: entry.metadata,
          }),
        ),
      )

      const data = await settingsPricingService.listPricingSettings({
        includeInactive: true,
      })

      return reply.send(successResponse({ summary, ...data }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update pricing settings'
      return reply.code(400).send({ success: false, message })
    }
  },

  async listRestrictedGoods(
    request: FastifyRequest<{
      Querystring: { includeInactive?: boolean }
    }>,
    reply: FastifyReply,
  ) {
    const data = await settingsRestrictedGoodsService.listRestrictedGoods(
      request.query.includeInactive,
    )
    return reply.send(successResponse(data))
  },

  async updateRestrictedGoods(
    request: FastifyRequest<{
      Body: {
        items?: Array<{
          id?: string
          code: string
          nameEn: string
          nameKo?: string
          description?: string
          allowWithOverride?: boolean
          isActive?: boolean
        }>
        deleteIds?: string[]
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const summary = await settingsRestrictedGoodsService.updateRestrictedGoods({
        actorId: request.user.id,
        items: request.body.items,
        deleteIds: request.body.deleteIds,
      })

      const auditEntries: Array<{
        action: string
        resourceType: string
        resourceId: string
      }> = []

      for (const id of summary.createdIds) {
        auditEntries.push({
          action: `Created restricted good ${id}`,
          resourceType: 'restricted_good',
          resourceId: id,
        })
      }
      for (const id of summary.updatedIds) {
        auditEntries.push({
          action: `Updated restricted good ${id}`,
          resourceType: 'restricted_good',
          resourceId: id,
        })
      }
      for (const id of summary.deletedIds) {
        auditEntries.push({
          action: `Deleted restricted good ${id}`,
          resourceType: 'restricted_good',
          resourceId: id,
        })
      }

      await Promise.all(
        auditEntries.map((entry) =>
          createAuditLog({
            userId: request.user.id,
            action: entry.action,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            request,
          }),
        ),
      )

      const data = await settingsRestrictedGoodsService.listRestrictedGoods(true)
      return reply.send(successResponse({ summary, items: data }))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to update restricted goods'
      return reply.code(400).send({ success: false, message })
    }
  },
}
