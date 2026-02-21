import { pgTable, uuid, text, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['superadmin', 'admin', 'staff', 'user'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),

  // ─── Identity (PII — AES-256 encrypted at rest) ───────────────────────────
  email: text('email').notNull().unique(),
  // firstName + lastName are nullable to support business accounts that use businessName only
  firstName: text('first_name'),
  lastName: text('last_name'),
  // Business / company name — encrypted; used for business accounts in place of firstName+lastName
  businessName: text('business_name'),

  // ─── Contact (PII — AES-256 encrypted at rest) ────────────────────────────
  phone: text('phone'),
  // WhatsApp-enabled number — null means same as phone
  whatsappNumber: text('whatsapp_number'),

  // ─── Address (optional at signup; required before placing an order) ────────
  // Street is encrypted (house number + street name is sensitive PII)
  addressStreet: text('address_street'),
  // Remaining parts are plain text (city/state/country alone are not uniquely identifying)
  addressCity: text('address_city'),
  addressState: text('address_state'),
  addressCountry: text('address_country'),
  addressPostalCode: text('address_postal_code'),

  // ─── Account settings ─────────────────────────────────────────────────────
  role: userRoleEnum('role').notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  consentMarketing: boolean('consent_marketing').notNull().default(false),

  // Soft delete — never hard delete user records
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
