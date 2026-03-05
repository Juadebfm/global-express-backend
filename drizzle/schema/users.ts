import { pgTable, uuid, text, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['superadmin', 'admin', 'staff', 'user'])
export const preferredLanguageEnum = pgEnum('preferred_language', ['en', 'ko'])
export const genderEnum = pgEnum('gender', ['male', 'female', 'other'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Clerk ID — present for customer accounts, null for internal staff/admin/superadmin
  clerkId: text('clerk_id').unique(),

  // ─── Internal auth (staff / admin / superadmin only — not used for Clerk accounts) ──
  // bcrypt hash of the password; null for Clerk-managed customer accounts
  passwordHash: text('password_hash'),
  // HMAC-SHA256(email.toLowerCase(), ENCRYPTION_KEY) — deterministic lookup key for login
  // Cannot query by encrypted email (random IV), so we store this hash instead
  emailHash: text('email_hash').unique(),

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

  // ─── Staff profile (internal users only — collected on first login) ────────
  gender: genderEnum('gender'),
  dateOfBirth: text('date_of_birth'), // encrypted PII
  emergencyContactName: text('emergency_contact_name'), // encrypted
  emergencyContactPhone: text('emergency_contact_phone'), // encrypted
  emergencyContactRelationship: text('emergency_contact_relationship'), // plain text
  nationalId: text('national_id'), // encrypted — optional, toggled by superadmin

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
  // Notification channel preferences (transactional events)
  notifyEmailAlerts: boolean('notify_email_alerts').notNull().default(true),
  notifySmsAlerts: boolean('notify_sms_alerts').notNull().default(true),
  notifyInAppAlerts: boolean('notify_in_app_alerts').notNull().default(true),
  preferredLanguage: preferredLanguageEnum('preferred_language').notNull().default('en'),

  // Internal users must change password on first login
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  // Internal users must complete profile after password change
  mustCompleteProfile: boolean('must_complete_profile').notNull().default(false),

  // Soft delete — never hard delete user records
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
