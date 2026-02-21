import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'

export const passwordResetOtps = pgTable('password_reset_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  otp: text('otp').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
