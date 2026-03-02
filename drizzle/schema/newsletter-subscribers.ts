import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  subscribedAt: timestamp('subscribed_at', { withTimezone: true }).defaultNow().notNull(),
})
