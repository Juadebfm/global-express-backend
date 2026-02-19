import { pgTable, uuid, text, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['superadmin', 'admin', 'staff', 'user'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  // PII fields stored AES-256 encrypted at rest
  email: text('email').notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  role: userRoleEnum('role').notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  // GDPR: record marketing consent
  consentMarketing: boolean('consent_marketing').notNull().default(false),
  // Soft delete — never hard delete user records
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
