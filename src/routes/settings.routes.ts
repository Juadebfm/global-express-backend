import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { settingsController } from '../controllers/settings.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireSuperAdmin, requireStaffOrAbove } from '../middleware/requireRole'
import { ipWhitelist } from '../middleware/ipWhitelist'
import { PreferredLanguage, TransportMode } from '../types/enums'

const ruleBaseSchema = z
  .object({
    minWeightKg: z.number().positive().optional(),
    maxWeightKg: z.number().positive().optional(),
    rateUsdPerKg: z.number().positive().optional(),
    flatRateUsdPerCbm: z.number().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.minWeightKg !== undefined &&
      value.maxWeightKg !== undefined &&
      value.maxWeightKg < value.minWeightKg
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxWeightKg'],
        message: 'maxWeightKg must be greater than or equal to minWeightKg',
      })
    }
  })

const defaultRuleUpsertSchema = ruleBaseSchema
  .extend({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    mode: z.nativeEnum(TransportMode),
    isActive: z.boolean().optional(),
    effectiveFrom: z.string().datetime().optional(),
    effectiveTo: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === TransportMode.AIR && value.rateUsdPerKg === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rateUsdPerKg'],
        message: 'rateUsdPerKg is required for air pricing rules',
      })
    }
    if (
      value.mode === TransportMode.SEA &&
      value.flatRateUsdPerCbm === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['flatRateUsdPerCbm'],
        message: 'flatRateUsdPerCbm is required for sea pricing rules',
      })
    }
    if (
      value.effectiveFrom &&
      value.effectiveTo &&
      new Date(value.effectiveTo) < new Date(value.effectiveFrom)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: 'effectiveTo must be greater than or equal to effectiveFrom',
      })
    }
  })

const customerOverrideUpsertSchema = ruleBaseSchema
  .extend({
    id: z.string().uuid().optional(),
    customerId: z.string().uuid(),
    mode: z.nativeEnum(TransportMode),
    isActive: z.boolean().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    notes: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === TransportMode.AIR && value.rateUsdPerKg === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rateUsdPerKg'],
        message: 'rateUsdPerKg is required for air customer overrides',
      })
    }
    if (
      value.mode === TransportMode.SEA &&
      value.flatRateUsdPerCbm === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['flatRateUsdPerCbm'],
        message: 'flatRateUsdPerCbm is required for sea customer overrides',
      })
    }
    if (
      value.startsAt &&
      value.endsAt &&
      new Date(value.endsAt) < new Date(value.startsAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'endsAt must be greater than or equal to startsAt',
      })
    }
  })

const pricingRuleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mode: z.nativeEnum(TransportMode),
  minWeightKg: z.string().nullable(),
  maxWeightKg: z.string().nullable(),
  rateUsdPerKg: z.string().nullable(),
  flatRateUsdPerCbm: z.string().nullable(),
  isActive: z.boolean(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const customerOverrideResponseSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  mode: z.nativeEnum(TransportMode),
  minWeightKg: z.string().nullable(),
  maxWeightKg: z.string().nullable(),
  rateUsdPerKg: z.string().nullable(),
  flatRateUsdPerCbm: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const restrictedGoodUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, 'code must contain only lowercase letters, numbers, underscore, or hyphen'),
  nameEn: z.string().min(1),
  nameKo: z.string().optional(),
  description: z.string().optional(),
  allowWithOverride: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

const restrictedGoodResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  nameEn: z.string(),
  nameKo: z.string().nullable(),
  description: z.string().nullable(),
  allowWithOverride: z.boolean(),
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const logisticsLaneSchema = z.object({
  originCountry: z.string(),
  originCity: z.string(),
  destinationCountry: z.string(),
  destinationCity: z.string(),
  isLocked: z.boolean(),
})

const logisticsOfficeSchema = z.object({
  nameEn: z.string(),
  nameKo: z.string(),
  addressEn: z.string(),
  addressKo: z.string(),
  phone: z.string().nullable(),
})

const logisticsEtaNotesSchema = z.object({
  airLeadTimeNote: z.string(),
  seaLeadTimeNote: z.string(),
})

const logisticsResponseSchema = z.object({
  lane: logisticsLaneSchema,
  koreaOffice: logisticsOfficeSchema,
  lagosOffice: logisticsOfficeSchema,
  etaNotes: logisticsEtaNotesSchema,
  updatedAt: z.string().nullable(),
})

const logisticsPatchSchema = z
  .object({
    lane: z
      .object({
        originCountry: z.string().min(1).optional(),
        originCity: z.string().min(1).optional(),
        destinationCountry: z.string().min(1).optional(),
        destinationCity: z.string().min(1).optional(),
        isLocked: z.boolean().optional(),
      })
      .optional(),
    koreaOffice: z
      .object({
        nameEn: z.string().min(1).optional(),
        nameKo: z.string().min(1).optional(),
        addressEn: z.string().min(1).optional(),
        addressKo: z.string().min(1).optional(),
        phone: z.string().min(1).nullable().optional(),
      })
      .optional(),
    lagosOffice: z
      .object({
        nameEn: z.string().min(1).optional(),
        nameKo: z.string().min(1).optional(),
        addressEn: z.string().min(1).optional(),
        addressKo: z.string().min(1).optional(),
        phone: z.string().min(1).nullable().optional(),
      })
      .optional(),
    etaNotes: z
      .object({
        airLeadTimeNote: z.string().min(1).optional(),
        seaLeadTimeNote: z.string().min(1).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnyMutation =
      value.lane !== undefined ||
      value.koreaOffice !== undefined ||
      value.lagosOffice !== undefined ||
      value.etaNotes !== undefined

    if (!hasAnyMutation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'At least one mutation is required: lane, koreaOffice, lagosOffice, or etaNotes',
      })
    }
  })

const fxRateResponseSchema = z.object({
  currencyPair: z.literal('USD_NGN'),
  mode: z.enum(['live', 'manual']),
  manualRate: z.number().positive().nullable(),
  updatedAt: z.string().nullable(),
  effectiveRate: z.number().positive().nullable().describe('Current effective USD→NGN rate (live fetch or manual, null if unavailable)'),
})

const fxRatePatchSchema = z
  .object({
    mode: z.enum(['live', 'manual']).optional(),
    manualRate: z.number().positive().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnyMutation =
      value.mode !== undefined || value.manualRate !== undefined

    if (!hasAnyMutation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one mutation is required: mode or manualRate',
      })
    }
  })

const notificationTemplateChannelSchema = z.enum(['email', 'in_app'])

const templateResponseSchema = z.object({
  id: z.string().uuid(),
  templateKey: z.string(),
  locale: z.nativeEnum(PreferredLanguage),
  channel: notificationTemplateChannelSchema,
  subject: z.string().nullable(),
  body: z.string(),
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const templatePatchBodySchema = z
  .object({
    templateKey: z.string().trim().min(1).optional(),
    locale: z.nativeEnum(PreferredLanguage).optional(),
    channel: notificationTemplateChannelSchema.optional(),
    subject: z.string().nullable().optional(),
    body: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnyMutation =
      value.templateKey !== undefined ||
      value.locale !== undefined ||
      value.channel !== undefined ||
      value.subject !== undefined ||
      value.body !== undefined ||
      value.isActive !== undefined

    if (!hasAnyMutation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'At least one mutation is required: templateKey, locale, channel, subject, body, or isActive',
      })
    }
  })

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/logistics', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Settings - Logistics'],
      summary: 'Get logistics settings (staff+)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: logisticsResponseSchema,
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.getLogistics,
  })

  app.patch('/logistics', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Settings - Logistics'],
      summary:
        'Update logistics settings (admin+; office address updates require superadmin)',
      security: [{ bearerAuth: [] }],
      body: logisticsPatchSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: logisticsResponseSchema,
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.updateLogistics,
  })

  app.get('/fx-rate', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Settings - FX'],
      summary: 'Get FX rate settings (staff+)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: fxRateResponseSchema,
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.getFxRate,
  })

  app.patch('/fx-rate', {
    preHandler: [authenticate, requireSuperAdmin, ipWhitelist],
    schema: {
      tags: ['Settings - FX'],
      summary: 'Update FX rate settings (superadmin)',
      security: [{ bearerAuth: [] }],
      body: fxRatePatchSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: fxRateResponseSchema,
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.updateFxRate,
  })

  app.get('/templates', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Settings - Templates'],
      summary: 'List notification templates (admin+)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        templateKey: z.string().trim().min(1).optional(),
        locale: z.nativeEnum(PreferredLanguage).optional(),
        channel: notificationTemplateChannelSchema.optional(),
        includeInactive: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(templateResponseSchema),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.listTemplates,
  })

  app.patch('/templates/:id', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Settings - Templates'],
      summary: 'Update notification template by id (admin+)',
      security: [{ bearerAuth: [] }],
      params: z.object({
        id: z.string().uuid(),
      }),
      body: templatePatchBodySchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: templateResponseSchema,
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.updateTemplate,
  })

  app.get('/pricing', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Settings - Pricing'],
      summary: 'List pricing rules and customer overrides (staff+)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        mode: z.nativeEnum(TransportMode).optional(),
        customerId: z.string().uuid().optional(),
        includeInactive: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            defaultRules: z.array(pricingRuleResponseSchema),
            customerOverrides: z.array(customerOverrideResponseSchema),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.listPricing,
  })

  app.patch('/pricing', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Settings - Pricing'],
      summary: 'Upsert/delete pricing rules and customer overrides (admin+)',
      security: [{ bearerAuth: [] }],
      body: z
        .object({
          defaultRules: z.array(defaultRuleUpsertSchema).optional(),
          customerOverrides: z.array(customerOverrideUpsertSchema).optional(),
          deleteDefaultRuleIds: z.array(z.string().uuid()).optional(),
          deleteCustomerOverrideIds: z.array(z.string().uuid()).optional(),
        })
        .superRefine((value, ctx) => {
          const hasAnyMutation =
            (value.defaultRules?.length ?? 0) > 0 ||
            (value.customerOverrides?.length ?? 0) > 0 ||
            (value.deleteDefaultRuleIds?.length ?? 0) > 0 ||
            (value.deleteCustomerOverrideIds?.length ?? 0) > 0

          if (!hasAnyMutation) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                'At least one mutation is required: defaultRules, customerOverrides, deleteDefaultRuleIds, or deleteCustomerOverrideIds',
            })
          }
        }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            summary: z.object({
              createdDefaultRuleIds: z.array(z.string().uuid()),
              updatedDefaultRuleIds: z.array(z.string().uuid()),
              deletedDefaultRuleIds: z.array(z.string().uuid()),
              createdCustomerOverrideIds: z.array(z.string().uuid()),
              updatedCustomerOverrideIds: z.array(z.string().uuid()),
              deletedCustomerOverrideIds: z.array(z.string().uuid()),
            }),
            defaultRules: z.array(pricingRuleResponseSchema),
            customerOverrides: z.array(customerOverrideResponseSchema),
          }),
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.updatePricing,
  })

  app.get('/restricted-goods', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Settings - Restricted Goods'],
      summary: 'List restricted goods catalog (staff+)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        includeInactive: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(restrictedGoodResponseSchema),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.listRestrictedGoods,
  })

  app.patch('/restricted-goods', {
    preHandler: [authenticate, requireAdminOrAbove, ipWhitelist],
    schema: {
      tags: ['Settings - Restricted Goods'],
      summary: 'Upsert/delete restricted goods catalog entries (admin+)',
      security: [{ bearerAuth: [] }],
      body: z
        .object({
          items: z.array(restrictedGoodUpsertSchema).optional(),
          deleteIds: z.array(z.string().uuid()).optional(),
        })
        .superRefine((value, ctx) => {
          const hasAnyMutation =
            (value.items?.length ?? 0) > 0 || (value.deleteIds?.length ?? 0) > 0

          if (!hasAnyMutation) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'At least one mutation is required: items or deleteIds',
            })
          }
        }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            summary: z.object({
              createdIds: z.array(z.string().uuid()),
              updatedIds: z.array(z.string().uuid()),
              deletedIds: z.array(z.string().uuid()),
            }),
            items: z.array(restrictedGoodResponseSchema),
          }),
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: settingsController.updateRestrictedGoods,
  })
}
