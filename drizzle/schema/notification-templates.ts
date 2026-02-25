import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  boolean,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { users, preferredLanguageEnum } from './users'

export const notificationTemplateChannelEnum = pgEnum('notification_template_channel', [
  'email',
  'in_app',
])

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateKey: text('template_key').notNull(),
    locale: preferredLanguageEnum('locale').notNull().default('en'),
    channel: notificationTemplateChannelEnum('channel').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_templates_key_locale_channel_unique_idx').on(
      table.templateKey,
      table.locale,
      table.channel,
    ),
    index('notification_templates_is_active_idx').on(table.isActive),
  ],
)
