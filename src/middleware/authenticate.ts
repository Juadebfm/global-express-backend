import type { FastifyRequest, FastifyReply } from 'fastify'
import { createClerkClient, verifyToken as verifyClerkToken } from '@clerk/backend'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { users, revokedTokens } from '../../drizzle/schema'
import { env } from '../config/env'
import { UserRole } from '../types/enums'
import { encrypt, decrypt, hashEmail } from '../utils/encryption'
import { internalAuthService } from '../services/internal-auth.service'
import { notificationsService } from '../services/notifications.service'

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })

type SignupMetadata = Record<string, unknown>
type RequiredSignupField =
  | 'phone'
  | 'addressStreet'
  | 'addressCity'
  | 'addressState'
  | 'addressCountry'
  | 'addressPostalCode'

interface RequiredSignupProfileInput {
  phone?: string | null
  addressStreet?: string | null
  addressCity?: string | null
  addressState?: string | null
  addressCountry?: string | null
  addressPostalCode?: string | null
}

function readMetadataString(
  metadata: SignupMetadata,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return undefined
}

function getMissingRequiredSignupFields(input: RequiredSignupProfileInput): RequiredSignupField[] {
  const missing: RequiredSignupField[] = []

  if (!input.phone?.trim()) missing.push('phone')
  if (!input.addressStreet?.trim()) missing.push('addressStreet')
  if (!input.addressCity?.trim()) missing.push('addressCity')
  if (!input.addressState?.trim()) missing.push('addressState')
  if (!input.addressCountry?.trim()) missing.push('addressCountry')
  if (!input.addressPostalCode?.trim()) missing.push('addressPostalCode')

  return missing
}

function buildMissingSignupFieldsMessage(missingFields: RequiredSignupField[]): string {
  return `Unprocessable — missing required signup fields: ${missingFields.join(', ')}`
}

function formatOptional(value: string | null | undefined): string {
  return value?.trim() || 'Not provided yet'
}

function formatLabel(value: string | null | undefined): string {
  const text = value?.trim()
  if (!text) return 'Not provided yet'

  return text
    .replace(/[_-]/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function buildNewCustomerSignupBody(input: {
  name: string | null
  email: string
  userId: string
  clerkId: string
  accountType?: string
  businessName?: string
  phone?: string
  whatsappNumber?: string
  addressStreet?: string
  addressState?: string
  addressPostalCode?: string
  country?: string
  city?: string
  preferredLanguage?: string
  signupAt: Date
}): string {
  return [
    'A new customer signed up.',
    '',
    `Name: ${formatOptional(input.name)}`,
    `Email: ${input.email}`,
    `Account type: ${formatLabel(input.accountType)}`,
    `Business name: ${formatOptional(input.businessName)}`,
    `Phone: ${formatOptional(input.phone)}`,
    `WhatsApp: ${formatOptional(input.whatsappNumber)}`,
    `Street: ${formatOptional(input.addressStreet)}`,
    `Country: ${formatOptional(input.country)}`,
    `City: ${formatOptional(input.city)}`,
    `State: ${formatOptional(input.addressState)}`,
    `Postal code: ${formatOptional(input.addressPostalCode)}`,
    `Preferred language: ${formatOptional(input.preferredLanguage)}`,
    `Customer ID: ${input.userId}`,
    `Clerk ID: ${input.clerkId}`,
    `Signup time: ${input.signupAt.toISOString()}`,
    'Profile status: Email verified, profile pending',
  ].join('\n')
}

/**
 * Unified authentication middleware handles two token types:
 *
 *   1. Internal JWT, issued by POST /api/v1/internal/auth/login
 *      for staff / admin / superadmin accounts.
 *
 *   2. Clerk JWT, issued by Clerk after customer sign-in.
 *
 * Attaches `request.user` identically for both paths.
 * Must be used as a preHandler on every protected route.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply
      .code(401)
      .send({ success: false, message: 'Unauthorized - missing or invalid Authorization header' })
    return
  }

  const token = authHeader.slice(7)

  // Peek at the JWT payload without verifying to check for an internal token.
  // We decode (not verify) to read the `type` claim so we know which path to take.
  // Actual verification happens inside each branch.
  let tokenType: string | undefined
  try {
    const parts = token.split('.')
    if (parts.length === 3) {
      const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      tokenType = decoded?.type
    }
  } catch {
    // Malformed token will fail in the appropriate branch below.
  }

  // Branch 1: Internal JWT
  if (tokenType === 'internal') {
    let payload: ReturnType<typeof internalAuthService.verifyToken>

    try {
      payload = internalAuthService.verifyToken(token)
    } catch {
      reply.code(401).send({ success: false, message: 'Unauthorized - invalid or expired token' })
      return
    }

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)))
        .limit(1)

      if (!user) {
        reply.code(401).send({ success: false, message: 'Unauthorized — account not found' })
        return
      }

      // Allow onboarding users (password change / profile completion) through
      // even though isActive is still false — matches validateCredentials logic
      const isOnboarding = user.mustChangePassword || user.mustCompleteProfile
      if (!user.isActive && !isOnboarding) {
        reply.code(403).send({ success: false, message: 'Forbidden — account is inactive' })
        return
      }

      const [revoked] = await db
        .select({ id: revokedTokens.id })
        .from(revokedTokens)
        .where(eq(revokedTokens.jti, payload.jti))
        .limit(1)

      if (revoked) {
        reply.code(401).send({ success: false, message: 'Unauthorized — token has been revoked' })
        return
      }

      request.user = {
        id: user.id,
        clerkId: null, // internal users have no Clerk account
        role: user.role,
        email: decrypt(user.email),
      }
    } catch (err) {
      request.log.error({ err }, 'Internal auth database lookup failed')
      reply.code(500).send({ success: false, message: 'Internal server error during authentication' })
    }

    return
  }

  // Branch 2: Clerk JWT (customers)
  let clerkId: string

  try {
    const payload = await verifyClerkToken(token, { secretKey: env.CLERK_SECRET_KEY })

    if (!payload?.sub) {
      reply.code(401).send({ success: false, message: 'Unauthorized - invalid token payload' })
      return
    }

    clerkId = payload.sub
  } catch {
    reply.code(401).send({ success: false, message: 'Unauthorized - token verification failed' })
    return
  }

  try {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.clerkId, clerkId), isNull(users.deletedAt)))
      .limit(1)

    if (existingUser) {
      if (!existingUser.isActive) {
        reply.code(403).send({ success: false, message: 'Forbidden - account is inactive' })
        return
      }

      // Internal operator roles must never authenticate through Clerk.
      if ([UserRole.STAFF, UserRole.SUPER_ADMIN].includes(existingUser.role as UserRole)) {
        reply.code(403).send({
          success: false,
          message: 'Forbidden — internal roles must sign in via internal auth',
        })
        return
      }

      request.user = {
        id: existingUser.id,
        clerkId: existingUser.clerkId,
        role: existingUser.role,
        email: decrypt(existingUser.email),
      }
      return
    }

    // If a soft-deleted user exists with this Clerk ID, do not auto-reprovision.
    // This preserves account deletion semantics and avoids unique constraint conflicts.
    const [deletedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1)

    if (deletedUser) {
      reply.code(403).send({ success: false, message: 'Forbidden — account has been deleted' })
      return
    }
    // Fetch Clerk user details (needed for stub-link check and auto-provision)
    const clerkUser = await clerk.users.getUser(clerkId)
    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )

    if (!primaryEmail) {
      reply
        .code(422)
        .send({ success: false, message: 'Unprocessable — no verified email found in Clerk' })
      return
    }

    const signupMetadata = {
      ...((clerkUser.publicMetadata ?? {}) as SignupMetadata),
      ...((clerkUser.unsafeMetadata ?? {}) as SignupMetadata),
    }
    const customerName = clerkUser.fullName ?? [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(' ')
    const accountType = readMetadataString(signupMetadata, ['accountType', 'account_type', 'type'])
    const businessName = readMetadataString(signupMetadata, ['businessName', 'business_name', 'company'])
    const metadataPhone = readMetadataString(signupMetadata, ['phone', 'phoneNumber', 'phone_number'])
    const phone = clerkUser.primaryPhoneNumber?.phoneNumber ?? metadataPhone
    const whatsappNumber = readMetadataString(signupMetadata, [
      'whatsappNumber',
      'whatsapp_number',
      'whatsapp',
    ])
    const addressStreet = readMetadataString(signupMetadata, [
      'addressStreet',
      'address_street',
      'streetAddress',
      'street',
      'addressLine1',
      'address_line_1',
    ])
    const country = readMetadataString(signupMetadata, ['country', 'addressCountry', 'address_country'])
    const city = readMetadataString(signupMetadata, ['city', 'addressCity', 'address_city'])
    const addressState = readMetadataString(signupMetadata, ['state', 'addressState', 'address_state'])
    const addressPostalCode = readMetadataString(signupMetadata, [
      'postalCode',
      'postal_code',
      'zip',
      'zipCode',
      'addressPostalCode',
      'address_postal_code',
    ])
    const preferredLanguage = readMetadataString(signupMetadata, [
      'preferredLanguage',
      'preferred_language',
      'locale',
    ])
    const signupPreferredLanguage =
      preferredLanguage?.toLowerCase() === 'ko'
        ? 'ko'
        : preferredLanguage?.toLowerCase() === 'en'
          ? 'en'
          : undefined

    // Use emailHash as the canonical identity key. This lets us safely reconnect
    // a verified Clerk user to an existing backend customer row if Clerk issued a
    // new user ID for the same email.
    const emailH = hashEmail(primaryEmail.emailAddress)
    const [emailOwner] = await db
      .select()
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.emailHash, emailH)))
      .limit(1)

    if (emailOwner) {
      if (emailOwner.role !== UserRole.USER) {
        reply.code(409).send({
          success: false,
          message:
            'Conflict - this email is already assigned to an internal account. Use operator login instead.',
        })
        return
      }

      const existingPhone = emailOwner.phone ? decrypt(emailOwner.phone) : undefined
      const existingAddressStreet = emailOwner.addressStreet
        ? decrypt(emailOwner.addressStreet)
        : undefined

      const resolvedPhone = existingPhone ?? phone
      const resolvedAddressStreet = existingAddressStreet ?? addressStreet
      const resolvedAddressCity = emailOwner.addressCity ?? city
      const resolvedAddressState = emailOwner.addressState ?? addressState
      const resolvedAddressCountry = emailOwner.addressCountry ?? country
      const resolvedAddressPostalCode = emailOwner.addressPostalCode ?? addressPostalCode

      const missingRequiredFields = getMissingRequiredSignupFields({
        phone: resolvedPhone,
        addressStreet: resolvedAddressStreet,
        addressCity: resolvedAddressCity,
        addressState: resolvedAddressState,
        addressCountry: resolvedAddressCountry,
        addressPostalCode: resolvedAddressPostalCode,
      })

      if (missingRequiredFields.length > 0) {
        reply
          .code(422)
          .send({ success: false, message: buildMissingSignupFieldsMessage(missingRequiredFields) })
        return
      }

      // Link staff-created stubs, or reconnect an existing customer row when a
      // new Clerk user ID is created for the same verified email address.
      const [linkedUser] = await db
        .update(users)
        .set({
          clerkId,
          isActive: true,
          firstName: emailOwner.firstName ?? (clerkUser.firstName ? encrypt(clerkUser.firstName) : null),
          lastName: emailOwner.lastName ?? (clerkUser.lastName ? encrypt(clerkUser.lastName) : null),
          businessName: emailOwner.businessName ?? (businessName ? encrypt(businessName) : null),
          phone: emailOwner.phone ?? encrypt(resolvedPhone!),
          whatsappNumber: emailOwner.whatsappNumber ?? (whatsappNumber ? encrypt(whatsappNumber) : null),
          addressStreet: emailOwner.addressStreet ?? encrypt(resolvedAddressStreet!),
          addressCity: emailOwner.addressCity ?? resolvedAddressCity!,
          addressState: emailOwner.addressState ?? resolvedAddressState!,
          addressCountry: emailOwner.addressCountry ?? resolvedAddressCountry!,
          addressPostalCode: emailOwner.addressPostalCode ?? resolvedAddressPostalCode!,
          preferredLanguage: signupPreferredLanguage ?? emailOwner.preferredLanguage,
          updatedAt: new Date(),
        })
        .where(eq(users.id, emailOwner.id))
        .returning()

      request.user = {
        id: linkedUser.id,
        clerkId: linkedUser.clerkId,
        role: linkedUser.role,
        email: primaryEmail.emailAddress,
      }
      return
    }

    const missingRequiredFields = getMissingRequiredSignupFields({
      phone,
      addressStreet,
      addressCity: city,
      addressState,
      addressCountry: country,
      addressPostalCode,
    })

    if (missingRequiredFields.length > 0) {
      reply
        .code(422)
        .send({ success: false, message: buildMissingSignupFieldsMessage(missingRequiredFields) })
      return
    }

    // No stub found — auto-provision a fresh account on first Clerk login
    const [newUser] = await db
      .insert(users)
      .values({
        clerkId,
        email: encrypt(primaryEmail.emailAddress),
        emailHash: emailH,
        firstName: clerkUser.firstName ? encrypt(clerkUser.firstName) : null,
        lastName: clerkUser.lastName ? encrypt(clerkUser.lastName) : null,
        businessName: businessName ? encrypt(businessName) : null,
        phone: encrypt(phone!),
        whatsappNumber: whatsappNumber ? encrypt(whatsappNumber) : null,
        addressStreet: encrypt(addressStreet!),
        addressCity: city!,
        addressState: addressState!,
        addressCountry: country!,
        addressPostalCode: addressPostalCode!,
        preferredLanguage: signupPreferredLanguage,
        role: UserRole.USER,
      })
      .returning()
    const signupAt = newUser.createdAt ?? new Date()

    request.user = {
      id: newUser.id,
      clerkId: newUser.clerkId,
      role: newUser.role,
      email: primaryEmail.emailAddress,
    }

    // Fire-and-forget: notify superadmin of new customer signup
    notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'new_customer',
      title: 'New Customer Signup',
      body: buildNewCustomerSignupBody({
        name: customerName,
        email: primaryEmail.emailAddress,
        userId: newUser.id,
        clerkId,
        accountType,
        businessName,
        phone,
        whatsappNumber,
        addressStreet,
        addressState,
        addressPostalCode,
        country,
        city,
        preferredLanguage,
        signupAt,
      }),
      metadata: {
        userId: newUser.id,
        clerkId,
        email: primaryEmail.emailAddress,
        name: customerName,
        accountType,
        businessName,
        phone,
        whatsappNumber,
        addressStreet,
        addressState,
        addressPostalCode,
        country,
        city,
        preferredLanguage,
        signupAt: signupAt.toISOString(),
      },
    })
  } catch (err) {
    request.log.error({ err }, 'Authentication database lookup failed')
    reply.code(500).send({ success: false, message: 'Internal server error during authentication' })
  }
}
