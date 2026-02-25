import { and, asc, eq } from 'drizzle-orm'
import { db } from '../config/db'
import { notificationTemplates } from '../../drizzle/schema'
import { PreferredLanguage } from '../types/enums'

export type NotificationTemplateChannel = 'email' | 'in_app'

export interface NotificationTemplateListParams {
  templateKey?: string
  locale?: PreferredLanguage
  channel?: NotificationTemplateChannel
  includeInactive?: boolean
}

export interface NotificationTemplateUpdateInput {
  id: string
  actorId: string
  templateKey?: string
  locale?: PreferredLanguage
  channel?: NotificationTemplateChannel
  subject?: string | null
  body?: string
  isActive?: boolean
}

function normalizeTemplateKey(templateKey: string): string {
  return templateKey.trim()
}

function mapTemplateRow(
  row: typeof notificationTemplates.$inferSelect,
): {
  id: string
  templateKey: string
  locale: PreferredLanguage
  channel: NotificationTemplateChannel
  subject: string | null
  body: string
  isActive: boolean
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
} {
  return {
    id: row.id,
    templateKey: row.templateKey,
    locale: row.locale as PreferredLanguage,
    channel: row.channel as NotificationTemplateChannel,
    subject: row.subject,
    body: row.body,
    isActive: row.isActive,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export class SettingsTemplatesService {
  async listTemplates(params: NotificationTemplateListParams = {}) {
    const includeInactive = params.includeInactive ?? false

    const where = and(
      params.templateKey
        ? eq(notificationTemplates.templateKey, normalizeTemplateKey(params.templateKey))
        : undefined,
      params.locale ? eq(notificationTemplates.locale, params.locale) : undefined,
      params.channel ? eq(notificationTemplates.channel, params.channel) : undefined,
      includeInactive ? undefined : eq(notificationTemplates.isActive, true),
    )

    const rows = await db
      .select()
      .from(notificationTemplates)
      .where(where)
      .orderBy(
        asc(notificationTemplates.templateKey),
        asc(notificationTemplates.locale),
        asc(notificationTemplates.channel),
      )

    return rows.map(mapTemplateRow)
  }

  async updateTemplate(input: NotificationTemplateUpdateInput) {
    const updateValues: Partial<typeof notificationTemplates.$inferInsert> = {
      updatedBy: input.actorId,
      updatedAt: new Date(),
    }

    if (input.templateKey !== undefined) {
      updateValues.templateKey = normalizeTemplateKey(input.templateKey)
    }
    if (input.locale !== undefined) {
      updateValues.locale = input.locale
    }
    if (input.channel !== undefined) {
      updateValues.channel = input.channel
    }
    if (input.subject !== undefined) {
      updateValues.subject = input.subject
    }
    if (input.body !== undefined) {
      updateValues.body = input.body
    }
    if (input.isActive !== undefined) {
      updateValues.isActive = input.isActive
    }

    const [updated] = await db
      .update(notificationTemplates)
      .set(updateValues)
      .where(eq(notificationTemplates.id, input.id))
      .returning()

    if (!updated) {
      throw new Error(`Notification template not found: ${input.id}`)
    }

    return mapTemplateRow(updated)
  }
}

export const settingsTemplatesService = new SettingsTemplatesService()
