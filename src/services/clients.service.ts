import { eq, and, isNull, isNotNull, sql, desc } from 'drizzle-orm'
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

/**
 * In-memory case-insensitive search across decrypted customer fields.
 * Used by listClients when `search` is provided — because the searchable
 * columns (email/firstName/lastName/businessName/shippingMark) are AES-GCM
 * encrypted at rest, we can't push the predicate into Postgres.
 *
 * Exported for unit testing — pure function, no DB.
 */
export function clientMatchesSearch(
  fields: {
    email: string | null
    firstName: string | null
    lastName: string | null
    businessName: string | null
    shippingMark: string | null
  },
  normalisedSearch: string,
): boolean {
  if (!normalisedSearch) return true
  const haystack = [
    fields.email,
    fields.firstName,
    fields.lastName,
    fields.businessName,
    fields.shippingMark,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase())
  return haystack.some((s) => s.includes(normalisedSearch))
}

// Max candidate rows we'll decrypt-and-scan per search request. The base SQL
// filter (role=user, deletedAt IS NULL, optionally isActive) already narrows
// hard. At single-digit-thousands of customers this is comfortable headroom;
// past ~50k we need a search projection column + trigram index.
const SEARCH_CANDIDATE_CAP = 10_000

export class ClientsService {
  /**
   * Paginated list of all customers (role=user) with order/payment aggregates.
   * Includes: orderCount, totalSpent (sum of successful payments), lastOrderDate.
   *
   * When `search` is provided, filters case-insensitively across decrypted
   * email/firstName/lastName/businessName/shippingMark (partial match, anywhere
   * in the field). Pagination is applied to the filtered set; pagination.total
   * reflects the filtered count.
   */
  async listClients(params: PaginationParams & { isActive?: boolean; search?: string }) {
    const baseWhere = and(
      isNull(users.deletedAt),
      eq(users.role, UserRole.USER),
      params.isActive !== undefined ? eq(users.isActive, params.isActive) : undefined,
    )

    const search = (params.search ?? '').trim().toLowerCase()

    // Fast path — no search: paginate at the DB level.
    if (!search) {
      const offset = getPaginationOffset(params.page, params.limit)

      const [data, countResult] = await Promise.all([
        db
          .select(this.listClientsSelect())
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

    // Search path — decrypt-and-filter in memory, then paginate.
    const candidates = await db
      .select(this.listClientsSelect())
      .from(users)
      .leftJoin(orders, and(eq(orders.senderId, users.id), isNull(orders.deletedAt)))
      .leftJoin(payments, eq(payments.userId, users.id))
      .where(baseWhere)
      .groupBy(users.id)
      .orderBy(desc(users.createdAt))
      .limit(SEARCH_CANDIDATE_CAP)

    const filtered = candidates.filter((row) =>
      clientMatchesSearch(
        {
          email: row.email ? decrypt(row.email) : null,
          firstName: row.firstName ? decrypt(row.firstName) : null,
          lastName: row.lastName ? decrypt(row.lastName) : null,
          businessName: row.businessName ? decrypt(row.businessName) : null,
          shippingMark: row.shippingMark ? decrypt(row.shippingMark) : null,
        },
        search,
      ),
    )

    const total = filtered.length
    const offset = getPaginationOffset(params.page, params.limit)
    const pageSlice = filtered.slice(offset, offset + params.limit)

    return buildPaginatedResult(
      pageSlice.map((row) => this.formatClient(row)),
      total,
      params,
    )
  }

  private listClientsSelect() {
    return {
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
      orderCount: sql<number>`count(distinct ${orders.id}) filter (where ${orders.id} is not null and ${orders.deletedAt} is null)::int`,
      totalSpent: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'successful'), 0)::text`,
      lastOrderDate: sql<string | null>`max(${orders.createdAt})::text`,
    }
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

  /**
   * Creates a dormant client stub without requiring an email address.
   * No Clerk account is provisioned; isActive is false until activateClient is called.
   * shippingMark is required (caller must provide a non-empty value).
   */
  async createDormantClient(input: {
    firstName?: string
    lastName?: string
    businessName?: string
    phone?: string
    whatsappNumber?: string
    email?: string
    shippingMark: string
    addressCity?: string
  }) {
    // Enforce shipping mark uniqueness (application-level, marks are AES-GCM encrypted
    // so there is no DB-level unique constraint — decrypt-and-compare is the only option).
    const normalised = input.shippingMark.trim().toLowerCase()
    const candidates = await db
      .select({ id: users.id, shippingMark: users.shippingMark })
      .from(users)
      .where(and(eq(users.role, UserRole.USER), isNull(users.deletedAt), isNotNull(users.shippingMark)))
    const collision = candidates.find(
      (row) => row.shippingMark && decrypt(row.shippingMark).toLowerCase() === normalised,
    )
    if (collision) {
      throw Object.assign(
        new Error('Shipping mark is already in use by another customer.'),
        { statusCode: 409 },
      )
    }

    const [stub] = await db
      .insert(users)
      .values({
        clerkId: null,
        email: input.email ? encrypt(input.email) : null,
        emailHash: input.email ? hashEmail(input.email) : null,
        firstName: input.firstName ? encrypt(input.firstName) : null,
        lastName: input.lastName ? encrypt(input.lastName) : null,
        businessName: input.businessName ? encrypt(input.businessName) : null,
        phone: input.phone ? encrypt(input.phone) : null,
        whatsappNumber: input.whatsappNumber ? encrypt(input.whatsappNumber) : null,
        shippingMark: encrypt(input.shippingMark),
        addressCity: input.addressCity ?? null,
        role: UserRole.USER,
        isActive: false,
      })
      .returning()

    return stub
  }

  /**
   * Activates a dormant client: sets isActive=true and sends a Clerk invitation.
   * Returns a discriminated union so the controller can map status codes cleanly.
   */
  async activateClient(id: string): Promise<
    | { status: 'ok'; client: NonNullable<Awaited<ReturnType<ClientsService['getClientById']>>> }
    | { status: 'not_found' }
    | { status: 'already_active' }
    | { status: 'no_email' }
  > {
    const client = await this.getClientById(id)
    if (!client) return { status: 'not_found' }
    if (client.isActive) return { status: 'already_active' }
    if (!client.email) return { status: 'no_email' }

    // Send the Clerk invite BEFORE updating the DB. If Clerk throws, the DB stays
    // unchanged (client remains dormant). If the DB update fails after a successful
    // invite, the Clerk webhook will set isActive=true when the customer signs up.
    await this.sendClerkInvite(client.email)

    await db.update(users).set({ isActive: true, updatedAt: new Date() }).where(eq(users.id, id))

    const updated = await this.getClientById(id)
    return { status: 'ok', client: updated! }
  }

  /**
   * Patches a client's details (staff-initiated). Only provided fields are updated.
   * Enforces shipping-mark uniqueness (decrypt-and-compare, excluding the same client).
   * Returns a discriminated union so the controller can map status codes cleanly.
   */
  async updateClientDetails(
    id: string,
    input: {
      firstName?: string
      lastName?: string
      businessName?: string
      email?: string
      phone?: string
      whatsappNumber?: string
      shippingMark?: string
      addressCity?: string
    },
  ): Promise<
    | { status: 'ok'; client: NonNullable<Awaited<ReturnType<ClientsService['getClientById']>>> }
    | { status: 'not_found' }
    | { status: 'shipping_mark_conflict' }
  > {
    // Fetch raw row so we can read encrypted fields without the JOIN aggregates
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.role, UserRole.USER), isNull(users.deletedAt)))
      .limit(1)

    if (!existing) return { status: 'not_found' }

    // Shipping mark uniqueness — decrypt-and-compare, skip if the mark is the
    // same one already held by this client.
    if (input.shippingMark !== undefined) {
      const normalised = input.shippingMark.trim().toLowerCase()
      const candidates = await db
        .select({ id: users.id, shippingMark: users.shippingMark })
        .from(users)
        .where(and(eq(users.role, UserRole.USER), isNull(users.deletedAt), isNotNull(users.shippingMark)))

      const collision = candidates.find((row) => {
        if (row.id === id) return false
        return row.shippingMark && decrypt(row.shippingMark).toLowerCase() === normalised
      })

      if (collision) return { status: 'shipping_mark_conflict' }
    }

    // Build update patch — only include keys that were explicitly provided.
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }

    if (input.firstName !== undefined) patch.firstName = input.firstName ? encrypt(input.firstName) : null
    if (input.lastName !== undefined) patch.lastName = input.lastName ? encrypt(input.lastName) : null
    if (input.businessName !== undefined) patch.businessName = input.businessName ? encrypt(input.businessName) : null
    if (input.phone !== undefined) patch.phone = input.phone ? encrypt(input.phone) : null
    if (input.whatsappNumber !== undefined) patch.whatsappNumber = input.whatsappNumber ? encrypt(input.whatsappNumber) : null
    if (input.shippingMark !== undefined) patch.shippingMark = input.shippingMark ? encrypt(input.shippingMark) : null
    if (input.addressCity !== undefined) patch.addressCity = input.addressCity || null

    if (input.email !== undefined) {
      patch.email = input.email ? encrypt(input.email) : null
      patch.emailHash = input.email ? hashEmail(input.email) : null
    }

    await db.update(users).set(patch).where(eq(users.id, id))

    const updated = await this.getClientById(id)
    return { status: 'ok', client: updated! }
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

    return actor?.role === UserRole.STAFF && actor.canProvisionClientLogin
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

    const [existing] = await db
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

    if (!clientRow.email) {
      throw httpError('Client has no email address — cannot provision login link.', 422)
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

    if (!clientRow.email) {
      throw httpError('Client has no email address — cannot resend login link.', 422)
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
      email: string | null
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
      email: row.email ? decrypt(row.email) : null,
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
