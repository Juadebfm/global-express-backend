import { eq, and, isNull, sql, desc } from 'drizzle-orm'
import { createClerkClient } from '@clerk/backend'
import { db } from '../config/db'
import { users, orders, payments } from '../../drizzle/schema'
import { encrypt, decrypt, hashEmail } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { env } from '../config/env'
import type { PaginationParams } from '../types'
import { UserRole } from '../types/enums'
import { sendClientLoginLinkEmail } from '../notifications/email'
import { sendClientLoginLinkWhatsApp } from '../notifications/whatsapp'

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

export class ClientsService {
  /**
   * Paginated list of all customers (role=user) with order/payment aggregates.
   * Includes: orderCount, totalSpent (sum of successful payments), lastOrderDate.
   */
  async listClients(params: PaginationParams & { isActive?: boolean }) {
    const offset = getPaginationOffset(params.page, params.limit)

    const baseWhere = and(
      isNull(users.deletedAt),
      eq(users.role, UserRole.USER),
      params.isActive !== undefined ? eq(users.isActive, params.isActive) : undefined,
    )

    const [data, countResult] = await Promise.all([
      db
        .select({
          // User fields
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          businessName: users.businessName,
        phone: users.phone,
        shippingMark: users.shippingMark,
        addressCity: users.addressCity,
          addressCountry: users.addressCountry,
          isActive: users.isActive,
          createdAt: users.createdAt,
          // Aggregates
          orderCount: sql<number>`count(distinct ${orders.id}) filter (where ${orders.id} is not null and ${orders.deletedAt} is null)::int`,
          totalSpent: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'successful'), 0)::text`,
          lastOrderDate: sql<string | null>`max(${orders.createdAt})::text`,
        })
        .from(users)
        .leftJoin(orders, and(eq(orders.senderId, users.id), isNull(orders.deletedAt)))
        .leftJoin(payments, eq(payments.userId, users.id))
        .where(baseWhere)
        .groupBy(users.id)
        .orderBy(desc(users.createdAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(baseWhere),
    ])

    const total = countResult[0]?.count ?? 0

    return buildPaginatedResult(
      data.map((row) => this.formatClient(row)),
      total,
      params,
    )
  }

  /**
   * Returns a single client by ID (must be role=user).
   */
  async getClientById(clientId: string) {
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        businessName: users.businessName,
        phone: users.phone,
        shippingMark: users.shippingMark,
        whatsappNumber: users.whatsappNumber,
        addressStreet: users.addressStreet,
        addressCity: users.addressCity,
        addressState: users.addressState,
        addressCountry: users.addressCountry,
        addressPostalCode: users.addressPostalCode,
        isActive: users.isActive,
        consentMarketing: users.consentMarketing,
        createdAt: users.createdAt,
        orderCount: sql<number>`count(distinct ${orders.id}) filter (where ${orders.id} is not null and ${orders.deletedAt} is null)::int`,
        totalSpent: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'successful'), 0)::text`,
        lastOrderDate: sql<string | null>`max(${orders.createdAt})::text`,
      })
      .from(users)
      .leftJoin(orders, and(eq(orders.senderId, users.id), isNull(orders.deletedAt)))
      .leftJoin(payments, eq(payments.userId, users.id))
      .where(and(eq(users.id, clientId), eq(users.role, UserRole.USER), isNull(users.deletedAt)))
      .groupBy(users.id)
      .limit(1)

    return row ? this.formatClient(row, true) : null
  }

  /**
   * Creates a staff-initiated client stub in the DB (clerkId=null, isActive=false).
   * The emailHash allows the authenticate middleware to link the record when the
   * customer later signs up via the Clerk invite.
   */
  async createClientStub(input: {
    email: string
    firstName?: string
    lastName?: string
    businessName?: string
    phone?: string
    shippingMark?: string
  }) {
    const [stub] = await db
      .insert(users)
      .values({
        clerkId: null,
        email: encrypt(input.email),
        emailHash: hashEmail(input.email),
        firstName: input.firstName ? encrypt(input.firstName) : null,
        lastName: input.lastName ? encrypt(input.lastName) : null,
        businessName: input.businessName ? encrypt(input.businessName) : null,
        phone: input.phone ? encrypt(input.phone) : null,
        shippingMark: input.shippingMark ? encrypt(input.shippingMark) : null,
        role: UserRole.USER,
        isActive: false,
      })
      .returning()

    return stub
  }

  /**
   * Sends (or re-sends) a Clerk invitation to the given email address.
   * Clerk will email the customer a sign-up link that pre-fills their email.
   */
  async sendClerkInvite(email: string) {
    return clerk.invitations.createInvitation({ emailAddress: email })
  }

  async canActorProvisionClientLoginLinks(actorId: string, actorRole: UserRole): Promise<boolean> {
    if (actorRole === UserRole.SUPER_ADMIN) return true
    if (actorRole !== UserRole.STAFF) return false

    const [actor] = await db
      .select({
        role: users.role,
        canProvisionClientLogin: users.canProvisionClientLogin,
      })
      .from(users)
      .where(and(eq(users.id, actorId), isNull(users.deletedAt)))
      .limit(1)

    return Boolean(actor && actor.role === UserRole.STAFF && actor.canProvisionClientLogin)
  }

  async provisionClientAndShareLoginLink(input: {
    actorRole: UserRole
    email: string
    firstName?: string
    lastName?: string
    businessName?: string
    phone?: string
    whatsappNumber?: string
    addressStreet?: string
    addressCity?: string
    addressState?: string
    addressCountry?: string
    addressPostalCode?: string
    shippingMark?: string
    consentMarketing?: boolean
  }) {
    const normalizedEmail = input.email.trim().toLowerCase()
    const normalizedFirstName = this.normalizeOptionalText(input.firstName)
    const normalizedLastName = this.normalizeOptionalText(input.lastName)
    const normalizedBusinessName = this.normalizeOptionalText(input.businessName)
    const normalizedPhone = this.normalizeOptionalText(input.phone)
    const normalizedWhatsapp = this.normalizeOptionalText(input.whatsappNumber)
    const normalizedStreet = this.normalizeOptionalText(input.addressStreet)
    const normalizedCity = this.normalizeOptionalText(input.addressCity)
    const normalizedState = this.normalizeOptionalText(input.addressState)
    const normalizedCountry = this.normalizeOptionalText(input.addressCountry)
    const normalizedPostalCode = this.normalizeOptionalText(input.addressPostalCode)
    const normalizedShippingMark = this.normalizeOptionalText(input.shippingMark)

    const emailHash = hashEmail(normalizedEmail)

    let [existing] = await db
      .select()
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1)

    if (existing && [UserRole.STAFF, UserRole.SUPER_ADMIN, UserRole.SUPPLIER].includes(existing.role as UserRole)) {
      throw httpError('Email already belongs to a non-client account.', 409)
    }

    if (existing && existing.role !== UserRole.USER) {
      throw httpError(`Email belongs to account role ${existing.role}.`, 409)
    }

    let clientRow: typeof users.$inferSelect

    if (existing) {
      const patch: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
        deletedAt: null,
      }

      if (normalizedFirstName !== undefined) patch.firstName = encrypt(normalizedFirstName)
      if (normalizedLastName !== undefined) patch.lastName = encrypt(normalizedLastName)
      if (normalizedBusinessName !== undefined) patch.businessName = encrypt(normalizedBusinessName)
      if (normalizedPhone !== undefined) patch.phone = encrypt(normalizedPhone)
      if (normalizedWhatsapp !== undefined) patch.whatsappNumber = encrypt(normalizedWhatsapp)
      if (normalizedStreet !== undefined) patch.addressStreet = encrypt(normalizedStreet)
      if (normalizedCity !== undefined) patch.addressCity = normalizedCity
      if (normalizedState !== undefined) patch.addressState = normalizedState
      if (normalizedCountry !== undefined) patch.addressCountry = normalizedCountry
      if (normalizedPostalCode !== undefined) patch.addressPostalCode = normalizedPostalCode
      if (input.consentMarketing !== undefined) patch.consentMarketing = input.consentMarketing

      if (normalizedShippingMark && input.actorRole === UserRole.SUPER_ADMIN) {
        patch.shippingMark = encrypt(normalizedShippingMark)
      }

      const [updated] = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, existing.id))
        .returning()

      if (!updated) {
        throw httpError('Unable to update existing client profile.', 500)
      }

      clientRow = updated
    } else {
      const [created] = await db
        .insert(users)
        .values({
          clerkId: null,
          email: encrypt(normalizedEmail),
          emailHash,
          firstName: normalizedFirstName ? encrypt(normalizedFirstName) : null,
          lastName: normalizedLastName ? encrypt(normalizedLastName) : null,
          businessName: normalizedBusinessName ? encrypt(normalizedBusinessName) : null,
          phone: normalizedPhone ? encrypt(normalizedPhone) : null,
          whatsappNumber: normalizedWhatsapp ? encrypt(normalizedWhatsapp) : null,
          addressStreet: normalizedStreet ? encrypt(normalizedStreet) : null,
          addressCity: normalizedCity ?? null,
          addressState: normalizedState ?? null,
          addressCountry: normalizedCountry ?? null,
          addressPostalCode: normalizedPostalCode ?? null,
          shippingMark:
            normalizedShippingMark && input.actorRole === UserRole.SUPER_ADMIN
              ? encrypt(normalizedShippingMark)
              : null,
          consentMarketing: input.consentMarketing ?? false,
          role: UserRole.USER,
          isActive: false,
        })
        .returning()

      clientRow = created
    }

    const emailAddress = decrypt(clientRow.email)
    const login = await this.createClientLoginLink({
      clerkId: clientRow.clerkId,
      email: emailAddress,
    })

    const recipientName = this.buildDisplayNameFromClientRow(clientRow)
    const whatsappTarget = this.resolveClientWhatsappNumber(clientRow)
    if (!whatsappTarget) {
      throw httpError(
        'WhatsApp or phone number is required to share login details. Update the client contact info and retry.',
        422,
      )
    }

    await Promise.all([
      sendClientLoginLinkEmail({
        to: emailAddress,
        recipientName,
        loginLink: login.url,
      }),
      sendClientLoginLinkWhatsApp({
        phone: whatsappTarget,
        recipientName,
        loginLink: login.url,
      }),
    ])

    return {
      id: clientRow.id,
      email: emailAddress,
      loginLink: login.url,
      linkType: login.type,
      whatsappNumber: whatsappTarget,
      wasExistingClient: Boolean(existing),
    }
  }

  async resendClientLoginLink(input: {
    clientId: string
    whatsappNumber?: string
    phone?: string
  }) {
    const [client] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, input.clientId), eq(users.role, UserRole.USER), isNull(users.deletedAt)))
      .limit(1)

    if (!client) {
      throw httpError('Client not found', 404)
    }

    const normalizedWhatsapp = this.normalizeOptionalText(input.whatsappNumber)
    const normalizedPhone = this.normalizeOptionalText(input.phone)

    let clientRow = client
    if (normalizedWhatsapp !== undefined || normalizedPhone !== undefined) {
      const patch: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      }

      if (normalizedWhatsapp !== undefined) {
        patch.whatsappNumber = normalizedWhatsapp ? encrypt(normalizedWhatsapp) : null
      }

      if (normalizedPhone !== undefined) {
        patch.phone = normalizedPhone ? encrypt(normalizedPhone) : null
      }

      const [updated] = await db.update(users).set(patch).where(eq(users.id, client.id)).returning()
      if (updated) clientRow = updated
    }

    const emailAddress = decrypt(clientRow.email)
    const login = await this.createClientLoginLink({
      clerkId: clientRow.clerkId,
      email: emailAddress,
    })

    const recipientName = this.buildDisplayNameFromClientRow(clientRow)
    const whatsappTarget = this.resolveClientWhatsappNumber(clientRow)
    if (!whatsappTarget) {
      throw httpError(
        'WhatsApp or phone number is required to share login details. Add contact info and retry.',
        422,
      )
    }

    await Promise.all([
      sendClientLoginLinkEmail({
        to: emailAddress,
        recipientName,
        loginLink: login.url,
      }),
      sendClientLoginLinkWhatsApp({
        phone: whatsappTarget,
        recipientName,
        loginLink: login.url,
      }),
    ])

    return {
      id: clientRow.id,
      email: emailAddress,
      loginLink: login.url,
      linkType: login.type,
      whatsappNumber: whatsappTarget,
    }
  }

  private async createClientLoginLink(input: { clerkId: string | null; email: string }) {
    if (input.clerkId) {
      const signInToken = await clerk.signInTokens.createSignInToken({
        userId: input.clerkId,
        expiresInSeconds: 60 * 60 * 24,
      })

      return {
        type: 'signin_token' as const,
        url: signInToken.url,
      }
    }

    const invitation = await clerk.invitations.createInvitation({
      emailAddress: input.email,
      ignoreExisting: true,
      notify: false,
      redirectUrl: `${this.getPublicAppBaseUrl()}/login`,
    })

    if (!invitation.url) {
      throw httpError('Failed to generate invitation link for this client.', 502)
    }

    return {
      type: 'invitation' as const,
      url: invitation.url,
    }
  }

  private getPublicAppBaseUrl(): string {
    const firstHttpOrigin = env.CORS_ORIGINS
      .split(',')
      .map((origin) => origin.trim())
      .find((origin) => origin.startsWith('http://') || origin.startsWith('https://'))

    return (firstHttpOrigin ?? 'https://app.globalexpress.kr').replace(/\/+$/, '')
  }

  private buildDisplayNameFromClientRow(client: typeof users.$inferSelect): string {
    const firstName = client.firstName ? decrypt(client.firstName) : null
    const lastName = client.lastName ? decrypt(client.lastName) : null
    const businessName = client.businessName ? decrypt(client.businessName) : null

    if (firstName && lastName) return `${firstName} ${lastName}`
    if (firstName) return firstName
    if (businessName) return businessName
    return 'Customer'
  }

  private resolveClientWhatsappNumber(client: typeof users.$inferSelect): string | null {
    if (client.whatsappNumber) return decrypt(client.whatsappNumber)
    if (client.phone) return decrypt(client.phone)
    return null
  }

  private normalizeOptionalText(value?: string): string | undefined {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  private formatClient(
    row: {
      id: string
      email: string
      firstName: string | null
      lastName: string | null
      businessName: string | null
      phone: string | null
      shippingMark: string | null
      isActive: boolean
      addressCity: string | null
      addressCountry: string | null
      createdAt: Date
      orderCount: number
      totalSpent: string
      lastOrderDate: string | null
      // optional extended fields
      whatsappNumber?: string | null
      addressStreet?: string | null
      addressState?: string | null
      addressPostalCode?: string | null
      consentMarketing?: boolean
    },
    extended = false,
  ) {
    const firstName = row.firstName ? decrypt(row.firstName) : null
    const lastName  = row.lastName  ? decrypt(row.lastName)  : null
    const businessName = row.businessName ? decrypt(row.businessName) : null

    let displayName: string | null = null
    if (firstName && lastName) displayName = `${firstName} ${lastName}`
    else if (firstName) displayName = firstName
    else if (businessName) displayName = businessName

    const base = {
      id: row.id,
      email: decrypt(row.email),
      firstName,
      lastName,
      businessName,
      displayName,
      phone: row.phone ? decrypt(row.phone) : null,
      shippingMark: row.shippingMark ? decrypt(row.shippingMark) : null,
      addressCity: row.addressCity,
      addressCountry: row.addressCountry,
      isActive: row.isActive,
      orderCount: row.orderCount,
      totalSpent: row.totalSpent,
      lastOrderDate: row.lastOrderDate,
      createdAt: row.createdAt.toISOString(),
    }

    if (!extended) return base

    return {
      ...base,
      whatsappNumber: row.whatsappNumber ? decrypt(row.whatsappNumber) : null,
      addressStreet: row.addressStreet ? decrypt(row.addressStreet) : null,
      addressState: row.addressState ?? null,
      addressPostalCode: row.addressPostalCode ?? null,
      consentMarketing: row.consentMarketing ?? false,
    }
  }
}

export const clientsService = new ClientsService()
