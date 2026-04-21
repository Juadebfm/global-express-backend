import { eq, and, isNull, sql, desc, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { users, orders, payments, orderPackages, userSuppliers } from '../../drizzle/schema'
import { encrypt, decrypt, hashEmail } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'
import { PreferredLanguage, UserRole } from '../types/enums'

export interface CreateUserInput {
  clerkId: string
  email: string
  firstName?: string | null
  lastName?: string | null
  businessName?: string | null
  phone?: string
  shippingMark?: string | null
  role?: UserRole
  preferredLanguage?: PreferredLanguage
}

export interface UpdateUserInput {
  firstName?: string | null
  lastName?: string | null
  businessName?: string | null
  phone?: string | null
  whatsappNumber?: string | null
  addressStreet?: string | null
  addressCity?: string | null
  addressState?: string | null
  addressCountry?: string | null
  addressPostalCode?: string | null
  shippingMark?: string | null
  isActive?: boolean
  consentMarketing?: boolean
  notifyEmailAlerts?: boolean
  notifySmsAlerts?: boolean
  notifyInAppAlerts?: boolean
  preferredLanguage?: PreferredLanguage
}

export interface UpdateNotificationPreferencesInput {
  notifyEmailAlerts?: boolean
  notifySmsAlerts?: boolean
  notifyInAppAlerts?: boolean
  consentMarketing?: boolean
}

export interface NotificationPreferences {
  notifyEmailAlerts: boolean
  notifySmsAlerts: boolean
  notifyInAppAlerts: boolean
  consentMarketing: boolean
}

export type UserRecord = Awaited<ReturnType<UsersService['getUserById']>>
export type DecryptedUser = NonNullable<UserRecord>

export interface GdprExportData {
  profile: DecryptedUser
  orders: Array<{
    trackingNumber: string
    origin: string
    destination: string
    statusV2: string | null
    shipmentType: string | null
    weight: string | null
    description: string | null
    recipientName: string
    recipientPhone: string
    createdAt: string
  }>
  payments: Array<{
    id: string
    amount: string
    currency: string
    status: string
    paymentType: string
    paystackReference: string | null
    paidAt: string | null
    createdAt: string
  }>
}

export type ProfileCompletenessMissingField =
  | 'name'
  | 'phone'
  | 'addressStreet'
  | 'addressCity'
  | 'addressState'
  | 'addressCountry'
  | 'addressPostalCode'

export interface ProfileCompletenessResult {
  isComplete: boolean
  missingFields: ProfileCompletenessMissingField[]
}

export interface SupplierListItem {
  id: string
  displayName: string
  firstName: string | null
  lastName: string | null
  businessName: string | null
  email: string
  phone: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  linkedCustomersCount: number
  lastLinkedAt: string | null
  shipmentUsageCount: number
  lastShipmentUsedAt: string | null
}

export interface MySupplierListItem extends SupplierListItem {
  source: 'saved' | 'used' | 'saved_and_used'
  savedAt: string | null
  usageCount: number
  lastUsedAt: string | null
}

export interface SaveMySupplierInput {
  userId: string
  supplierId?: string
  email?: string
  firstName?: string | null
  lastName?: string | null
  businessName?: string | null
  phone?: string | null
}

export type SaveMySupplierResult =
  | {
      status: 'ok'
      data: {
        supplier: MySupplierListItem
        createdSupplier: boolean
        linkedNow: boolean
      }
    }
  | { status: 'not_found' }
  | { status: 'forbidden'; message: string }
  | { status: 'conflict'; message: string }

interface SupplierLinkResult {
  linkedNow: boolean
  linkedAt: Date
}

interface SupplierUserRow {
  id: string
  firstName: string | null
  lastName: string | null
  businessName: string | null
  email: string
  phone: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export class UsersService {
  async createUser(input: CreateUserInput) {
    const [user] = await db
      .insert(users)
      .values({
        clerkId: input.clerkId,
        email: encrypt(input.email),
        firstName: input.firstName ? encrypt(input.firstName) : null,
        lastName: input.lastName ? encrypt(input.lastName) : null,
        businessName: input.businessName ? encrypt(input.businessName) : null,
        phone: input.phone ? encrypt(input.phone) : null,
        shippingMark: input.shippingMark ? encrypt(input.shippingMark) : null,
        role: input.role ?? UserRole.USER,
        preferredLanguage: input.preferredLanguage ?? PreferredLanguage.EN,
      })
      .returning()

    return this.decryptUser(user)
  }

  async getUserById(id: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)

    return user ? this.decryptUser(user) : null
  }

  async getUserByClerkId(clerkId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.clerkId, clerkId), isNull(users.deletedAt)))
      .limit(1)

    return user ? this.decryptUser(user) : null
  }

  async updateUser(id: string, input: UpdateUserInput) {
    const patch: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (input.firstName !== undefined) {
      patch.firstName = input.firstName ? encrypt(input.firstName) : null
    }
    if (input.lastName !== undefined) {
      patch.lastName = input.lastName ? encrypt(input.lastName) : null
    }
    if (input.businessName !== undefined) {
      patch.businessName = input.businessName ? encrypt(input.businessName) : null
    }
    if (input.phone !== undefined) {
      patch.phone = input.phone ? encrypt(input.phone) : null
    }
    if (input.whatsappNumber !== undefined) {
      patch.whatsappNumber = input.whatsappNumber ? encrypt(input.whatsappNumber) : null
    }
    if (input.addressStreet !== undefined) {
      patch.addressStreet = input.addressStreet ? encrypt(input.addressStreet) : null
    }
    if (input.addressCity !== undefined) patch.addressCity = input.addressCity
    if (input.addressState !== undefined) patch.addressState = input.addressState
    if (input.addressCountry !== undefined) patch.addressCountry = input.addressCountry
    if (input.addressPostalCode !== undefined) patch.addressPostalCode = input.addressPostalCode
    if (input.shippingMark !== undefined) {
      patch.shippingMark = input.shippingMark ? encrypt(input.shippingMark) : null
    }
    if (input.isActive !== undefined) patch.isActive = input.isActive
    if (input.consentMarketing !== undefined) patch.consentMarketing = input.consentMarketing
    if (input.notifyEmailAlerts !== undefined) patch.notifyEmailAlerts = input.notifyEmailAlerts
    if (input.notifySmsAlerts !== undefined) patch.notifySmsAlerts = input.notifySmsAlerts
    if (input.notifyInAppAlerts !== undefined) patch.notifyInAppAlerts = input.notifyInAppAlerts
    if (input.preferredLanguage !== undefined) patch.preferredLanguage = input.preferredLanguage

    const [updated] = await db
      .update(users)
      .set(patch)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning()

    return updated ? this.decryptUser(updated) : null
  }

  async getNotificationPreferences(id: string): Promise<NotificationPreferences | null> {
    const user = await this.getUserById(id)
    if (!user) return null

    return {
      notifyEmailAlerts: user.notifyEmailAlerts,
      notifySmsAlerts: user.notifySmsAlerts,
      notifyInAppAlerts: user.notifyInAppAlerts,
      consentMarketing: user.consentMarketing,
    }
  }

  async updateNotificationPreferences(
    id: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences | null> {
    const patch: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (input.notifyEmailAlerts !== undefined) patch.notifyEmailAlerts = input.notifyEmailAlerts
    if (input.notifySmsAlerts !== undefined) patch.notifySmsAlerts = input.notifySmsAlerts
    if (input.notifyInAppAlerts !== undefined) patch.notifyInAppAlerts = input.notifyInAppAlerts
    if (input.consentMarketing !== undefined) patch.consentMarketing = input.consentMarketing

    const [updated] = await db
      .update(users)
      .set(patch)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning()

    if (!updated) return null

    return {
      notifyEmailAlerts: updated.notifyEmailAlerts,
      notifySmsAlerts: updated.notifySmsAlerts,
      notifyInAppAlerts: updated.notifyInAppAlerts,
      consentMarketing: updated.consentMarketing,
    }
  }

  async updateUserRole(id: string, role: UserRole) {
    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning()

    return updated ? this.decryptUser(updated) : null
  }

  async softDeleteUser(id: string) {
    const [deleted] = await db
      .update(users)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning({ id: users.id })

    return deleted ?? null
  }

  async listUsers(
    params: PaginationParams & { role?: UserRole; search?: string; isActive?: boolean },
  ) {
    const offset = getPaginationOffset(params.page, params.limit)

    const baseWhere = and(
      isNull(users.deletedAt),
      params.role ? eq(users.role, params.role) : undefined,
      params.isActive !== undefined ? eq(users.isActive, params.isActive) : undefined,
    )

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(users)
        .where(baseWhere)
        .orderBy(users.createdAt)
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(baseWhere),
    ])

    const total = countResult[0]?.count ?? 0
    return buildPaginatedResult(
      data.map((u) => this.decryptUser(u)),
      total,
      params,
    )
  }

  async listSuppliers(params: PaginationParams & { isActive?: boolean }) {
    const offset = getPaginationOffset(params.page, params.limit)

    const baseWhere = and(
      isNull(users.deletedAt),
      eq(users.role, UserRole.SUPPLIER),
      params.isActive !== undefined ? eq(users.isActive, params.isActive) : undefined,
    )

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(users)
        .where(baseWhere)
        .orderBy(users.createdAt)
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(baseWhere),
    ])

    const supplierIds = data.map((u) => u.id)
    const linkedStatsBySupplierId = new Map<string, { linkedCustomersCount: number; lastLinkedAt: Date | null }>()
    const usageStatsBySupplierId = new Map<string, { shipmentUsageCount: number; lastShipmentUsedAt: Date | null }>()

    if (supplierIds.length > 0) {
      const [linkedStats, usageStats] = await Promise.all([
        db
          .select({
            supplierId: userSuppliers.supplierId,
            linkedCustomersCount: sql<number>`count(distinct ${userSuppliers.userId})::int`,
            lastLinkedAt: sql<Date | null>`max(${userSuppliers.createdAt})`,
          })
          .from(userSuppliers)
          .where(inArray(userSuppliers.supplierId, supplierIds))
          .groupBy(userSuppliers.supplierId),
        db
          .select({
            supplierId: orderPackages.supplierId,
            shipmentUsageCount: sql<number>`count(${orderPackages.id})::int`,
            lastShipmentUsedAt: sql<Date | null>`max(${orderPackages.arrivalAt})`,
          })
          .from(orderPackages)
          .innerJoin(orders, eq(orders.id, orderPackages.orderId))
          .where(
            and(
              inArray(orderPackages.supplierId, supplierIds),
              isNull(orders.deletedAt),
            ),
          )
          .groupBy(orderPackages.supplierId),
      ])

      for (const row of linkedStats) {
        linkedStatsBySupplierId.set(row.supplierId, {
          linkedCustomersCount: row.linkedCustomersCount,
          lastLinkedAt: row.lastLinkedAt ?? null,
        })
      }

      for (const row of usageStats) {
        if (!row.supplierId) continue
        usageStatsBySupplierId.set(row.supplierId, {
          shipmentUsageCount: row.shipmentUsageCount,
          lastShipmentUsedAt: row.lastShipmentUsedAt ?? null,
        })
      }
    }

    const normalized: SupplierListItem[] = data.map((u) => {
      const linked = linkedStatsBySupplierId.get(u.id)
      const usage = usageStatsBySupplierId.get(u.id)

      return this.toSupplierListItem(u, {
        linkedCustomersCount: linked?.linkedCustomersCount ?? 0,
        lastLinkedAt: linked?.lastLinkedAt ?? null,
        shipmentUsageCount: usage?.shipmentUsageCount ?? 0,
        lastShipmentUsedAt: usage?.lastShipmentUsedAt ?? null,
      })
    })

    const total = countResult[0]?.count ?? 0
    return buildPaginatedResult(normalized, total, params)
  }

  async listMySuppliers(params: PaginationParams & { userId: string; isActive?: boolean }) {
    const [savedRows, usedRows] = await Promise.all([
      db
        .select({
          supplierId: users.id,
          supplierFirstName: users.firstName,
          supplierLastName: users.lastName,
          supplierBusinessName: users.businessName,
          supplierEmail: users.email,
          supplierPhone: users.phone,
          supplierIsActive: users.isActive,
          supplierCreatedAt: users.createdAt,
          supplierUpdatedAt: users.updatedAt,
          relationCreatedAt: userSuppliers.createdAt,
        })
        .from(userSuppliers)
        .innerJoin(users, eq(userSuppliers.supplierId, users.id))
        .where(
          and(
            eq(userSuppliers.userId, params.userId),
            eq(users.role, UserRole.SUPPLIER),
            isNull(users.deletedAt),
            params.isActive !== undefined ? eq(users.isActive, params.isActive) : undefined,
          ),
        )
        .orderBy(desc(userSuppliers.createdAt)),
      db
        .select({
          supplierId: users.id,
          supplierFirstName: users.firstName,
          supplierLastName: users.lastName,
          supplierBusinessName: users.businessName,
          supplierEmail: users.email,
          supplierPhone: users.phone,
          supplierIsActive: users.isActive,
          supplierCreatedAt: users.createdAt,
          supplierUpdatedAt: users.updatedAt,
          usageCount: sql<number>`count(${orderPackages.id})::int`,
          lastUsedAt: sql<Date | null>`max(${orderPackages.arrivalAt})`,
        })
        .from(orderPackages)
        .innerJoin(orders, eq(orders.id, orderPackages.orderId))
        .innerJoin(users, eq(orderPackages.supplierId, users.id))
        .where(
          and(
            eq(orders.senderId, params.userId),
            isNull(orders.deletedAt),
            eq(users.role, UserRole.SUPPLIER),
            isNull(users.deletedAt),
            params.isActive !== undefined ? eq(users.isActive, params.isActive) : undefined,
          ),
        )
        .groupBy(
          users.id,
          users.firstName,
          users.lastName,
          users.businessName,
          users.email,
          users.phone,
          users.isActive,
          users.createdAt,
          users.updatedAt,
        ),
    ])

    const supplierMap = new Map<
      string,
      {
        supplier: SupplierListItem
        savedAt: Date | null
        usageCount: number
        lastUsedAt: Date | null
        hasSaved: boolean
        hasUsed: boolean
      }
    >()

    for (const row of savedRows) {
      const supplier = this.toSupplierListItem(
        {
          id: row.supplierId,
          firstName: row.supplierFirstName,
          lastName: row.supplierLastName,
          businessName: row.supplierBusinessName,
          email: row.supplierEmail,
          phone: row.supplierPhone,
          isActive: row.supplierIsActive,
          createdAt: row.supplierCreatedAt,
          updatedAt: row.supplierUpdatedAt,
        },
        {
          linkedCustomersCount: 1,
          lastLinkedAt: row.relationCreatedAt,
          shipmentUsageCount: 0,
          lastShipmentUsedAt: null,
        },
      )

      supplierMap.set(row.supplierId, {
        supplier,
        savedAt: row.relationCreatedAt,
        usageCount: 0,
        lastUsedAt: null,
        hasSaved: true,
        hasUsed: false,
      })
    }

    for (const row of usedRows) {
      const existing = supplierMap.get(row.supplierId)

      if (existing) {
        existing.usageCount = row.usageCount
        existing.lastUsedAt = row.lastUsedAt ?? null
        existing.hasUsed = true
        existing.supplier.shipmentUsageCount = row.usageCount
        existing.supplier.lastShipmentUsedAt = row.lastUsedAt?.toISOString() ?? null
        continue
      }

      const supplier = this.toSupplierListItem(
        {
          id: row.supplierId,
          firstName: row.supplierFirstName,
          lastName: row.supplierLastName,
          businessName: row.supplierBusinessName,
          email: row.supplierEmail,
          phone: row.supplierPhone,
          isActive: row.supplierIsActive,
          createdAt: row.supplierCreatedAt,
          updatedAt: row.supplierUpdatedAt,
        },
        {
          linkedCustomersCount: 0,
          lastLinkedAt: null,
          shipmentUsageCount: row.usageCount,
          lastShipmentUsedAt: row.lastUsedAt ?? null,
        },
      )

      supplierMap.set(row.supplierId, {
        supplier,
        savedAt: null,
        usageCount: row.usageCount,
        lastUsedAt: row.lastUsedAt ?? null,
        hasSaved: false,
        hasUsed: true,
      })
    }

    const normalized: MySupplierListItem[] = [...supplierMap.values()]
      .map((entry) => {
        const source: MySupplierListItem['source'] =
          entry.hasSaved && entry.hasUsed ? 'saved_and_used' : entry.hasSaved ? 'saved' : 'used'

        return {
          ...entry.supplier,
          source,
          savedAt: entry.savedAt?.toISOString() ?? null,
          usageCount: entry.usageCount,
          lastUsedAt: entry.lastUsedAt?.toISOString() ?? null,
        }
      })
      .sort((a, b) => {
        const aTime = Math.max(
          a.savedAt ? new Date(a.savedAt).getTime() : 0,
          a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0,
          new Date(a.updatedAt).getTime(),
        )
        const bTime = Math.max(
          b.savedAt ? new Date(b.savedAt).getTime() : 0,
          b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0,
          new Date(b.updatedAt).getTime(),
        )
        return bTime - aTime
      })

    const total = normalized.length
    const offset = getPaginationOffset(params.page, params.limit)
    const paginated = normalized.slice(offset, offset + params.limit)

    return buildPaginatedResult(paginated, total, params)
  }

  async saveMySupplier(input: SaveMySupplierInput): Promise<SaveMySupplierResult> {
    const normalizedSupplierId = input.supplierId?.trim()

    if (normalizedSupplierId) {
      if (normalizedSupplierId === input.userId) {
        return { status: 'forbidden', message: 'You cannot save yourself as a supplier' }
      }

      const [existingSupplier] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.id, normalizedSupplierId),
            eq(users.role, UserRole.SUPPLIER),
            isNull(users.deletedAt),
          ),
        )
        .limit(1)

      if (!existingSupplier) {
        return { status: 'not_found' }
      }

      const link = await this.ensureUserSupplierLink({
        userId: input.userId,
        supplierId: existingSupplier.id,
        linkedByUserId: input.userId,
      })
      const usage = await this.getUserSupplierUsage(input.userId, existingSupplier.id)

      return {
        status: 'ok',
        data: {
          supplier: {
            ...this.toSupplierListItem(existingSupplier, {
              linkedCustomersCount: 1,
              lastLinkedAt: link.linkedAt,
              shipmentUsageCount: usage.usageCount,
              lastShipmentUsedAt: usage.lastUsedAt,
            }),
            source: usage.usageCount > 0 ? 'saved_and_used' : 'saved',
            savedAt: link.linkedAt.toISOString(),
            usageCount: usage.usageCount,
            lastUsedAt: usage.lastUsedAt?.toISOString() ?? null,
          },
          createdSupplier: false,
          linkedNow: link.linkedNow,
        },
      }
    }

    const normalizedEmail = input.email?.trim().toLowerCase()
    if (!normalizedEmail) {
      return { status: 'conflict', message: 'supplierId or email is required' }
    }

    const requester = await db
      .select({ emailHash: users.emailHash })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .limit(1)

    if (!requester[0]) {
      return { status: 'not_found' }
    }

    const targetEmailHash = hashEmail(normalizedEmail)
    if (requester[0].emailHash && requester[0].emailHash === targetEmailHash) {
      return { status: 'forbidden', message: 'You cannot save yourself as a supplier' }
    }

    const normalizedFirstName = this.normalizeNullableText(input.firstName)
    const normalizedLastName = this.normalizeNullableText(input.lastName)
    const normalizedBusinessName = this.normalizeNullableText(input.businessName)
    const normalizedPhone = this.normalizeNullableText(input.phone)

    let supplier = await this.findUserByEmailHash(targetEmailHash)
    let createdSupplier = false

    if (supplier && supplier.role !== UserRole.SUPPLIER) {
      return {
        status: 'conflict',
        message: 'This email already belongs to a non-supplier account',
      }
    }

    if (supplier?.id === input.userId) {
      return { status: 'forbidden', message: 'You cannot save yourself as a supplier' }
    }

    if (!supplier) {
      try {
        const [created] = await db
          .insert(users)
          .values({
            clerkId: null,
            role: UserRole.SUPPLIER,
            email: encrypt(normalizedEmail),
            emailHash: targetEmailHash,
            firstName: normalizedFirstName ? encrypt(normalizedFirstName) : null,
            lastName: normalizedLastName ? encrypt(normalizedLastName) : null,
            businessName: normalizedBusinessName ? encrypt(normalizedBusinessName) : null,
            phone: normalizedPhone ? encrypt(normalizedPhone) : null,
            isActive: true,
          })
          .returning()

        supplier = created
        createdSupplier = true
      } catch {
        supplier = await this.findUserByEmailHash(targetEmailHash)
        if (!supplier || supplier.role !== UserRole.SUPPLIER) {
          return {
            status: 'conflict',
            message: 'Unable to create supplier with the provided email',
          }
        }
      }
    }

    if (!supplier) {
      return { status: 'conflict', message: 'Unable to resolve supplier' }
    }

    const supplierPatch: Partial<typeof users.$inferInsert> = {}
    if (supplier.deletedAt) supplierPatch.deletedAt = null
    if (!supplier.isActive) supplierPatch.isActive = true
    if (!supplier.firstName && normalizedFirstName) supplierPatch.firstName = encrypt(normalizedFirstName)
    if (!supplier.lastName && normalizedLastName) supplierPatch.lastName = encrypt(normalizedLastName)
    if (!supplier.businessName && normalizedBusinessName) {
      supplierPatch.businessName = encrypt(normalizedBusinessName)
    }
    if (!supplier.phone && normalizedPhone) supplierPatch.phone = encrypt(normalizedPhone)

    if (Object.keys(supplierPatch).length > 0) {
      supplierPatch.updatedAt = new Date()
      const [updatedSupplier] = await db
        .update(users)
        .set(supplierPatch)
        .where(eq(users.id, supplier.id))
        .returning()
      supplier = updatedSupplier ?? supplier
    }

    const link = await this.ensureUserSupplierLink({
      userId: input.userId,
      supplierId: supplier.id,
      linkedByUserId: input.userId,
    })
    const usage = await this.getUserSupplierUsage(input.userId, supplier.id)

    return {
      status: 'ok',
      data: {
        supplier: {
          ...this.toSupplierListItem(supplier, {
            linkedCustomersCount: 1,
            lastLinkedAt: link.linkedAt,
            shipmentUsageCount: usage.usageCount,
            lastShipmentUsedAt: usage.lastUsedAt,
          }),
          source: usage.usageCount > 0 ? 'saved_and_used' : 'saved',
          savedAt: link.linkedAt.toISOString(),
          usageCount: usage.usageCount,
          lastUsedAt: usage.lastUsedAt?.toISOString() ?? null,
        },
        createdSupplier,
        linkedNow: link.linkedNow,
      },
    }
  }

  /**
   * Called by the Clerk webhook handler when a user.updated event is received.
   * Only fields present in the payload are updated; undefined fields are left unchanged.
   */
  async syncFromClerk(
    clerkId: string,
    data: {
      email?: string
      firstName?: string
      lastName?: string
      phone?: string | null
    },
  ) {
    const patch: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (data.email !== undefined) patch.email = encrypt(data.email)
    if (data.firstName !== undefined) {
      patch.firstName = data.firstName ? encrypt(data.firstName) : null
    }
    if (data.lastName !== undefined) {
      patch.lastName = data.lastName ? encrypt(data.lastName) : null
    }
    if (data.phone !== undefined) {
      patch.phone = data.phone ? encrypt(data.phone) : null
    }

    const [updated] = await db
      .update(users)
      .set(patch)
      .where(eq(users.clerkId, clerkId))
      .returning()

    return updated ? this.decryptUser(updated) : null
  }

  /** GDPR: export all personal data for a user (profile + orders + payments). */
  async exportUserData(id: string): Promise<GdprExportData | null> {
    const user = await this.getUserById(id)
    if (!user) return null

    const [userOrders, userPayments] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(and(eq(orders.senderId, id), isNull(orders.deletedAt)))
        .orderBy(desc(orders.createdAt)),
      db
        .select()
        .from(payments)
        .where(eq(payments.userId, id))
        .orderBy(desc(payments.createdAt)),
    ])

    return {
      profile: user,
      orders: userOrders.map((o) => ({
        trackingNumber: o.trackingNumber,
        origin: o.origin,
        destination: o.destination,
        statusV2: o.statusV2,
        shipmentType: o.shipmentType,
        weight: o.weight,
        description: o.description,
        recipientName: decrypt(o.recipientName),
        recipientPhone: decrypt(o.recipientPhone),
        createdAt: o.createdAt.toISOString(),
      })),
      payments: userPayments.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        paymentType: p.paymentType,
        paystackReference: p.paystackReference,
        paidAt: p.paidAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    }
  }

  /**
   * Returns profile completeness and missing field keys required to place an order:
   *   - At least one of: (firstName + lastName) or businessName
   *   - phone
   *   - all 5 address fields
   */
  getProfileCompleteness(user: DecryptedUser): ProfileCompletenessResult {
    const missingFields: ProfileCompletenessMissingField[] = []

    const hasName = (user.firstName && user.lastName) || user.businessName
    if (!hasName) missingFields.push('name')

    if (!user.phone) missingFields.push('phone')
    if (!user.addressStreet) missingFields.push('addressStreet')
    if (!user.addressCity) missingFields.push('addressCity')
    if (!user.addressState) missingFields.push('addressState')
    if (!user.addressCountry) missingFields.push('addressCountry')
    if (!user.addressPostalCode) missingFields.push('addressPostalCode')

    return {
      isComplete: missingFields.length === 0,
      missingFields,
    }
  }

  isProfileComplete(user: DecryptedUser): boolean {
    return this.getProfileCompleteness(user).isComplete
  }

  private toSupplierListItem(
    supplier: SupplierUserRow,
    stats: {
      linkedCustomersCount: number
      lastLinkedAt: Date | null
      shipmentUsageCount: number
      lastShipmentUsedAt: Date | null
    },
  ): SupplierListItem {
    const firstName = supplier.firstName ? decrypt(supplier.firstName) : null
    const lastName = supplier.lastName ? decrypt(supplier.lastName) : null
    const businessName = supplier.businessName ? decrypt(supplier.businessName) : null

    return {
      id: supplier.id,
      displayName: this.buildDisplayName(firstName, lastName, businessName),
      firstName,
      lastName,
      businessName,
      email: decrypt(supplier.email),
      phone: supplier.phone ? decrypt(supplier.phone) : null,
      isActive: supplier.isActive,
      createdAt: supplier.createdAt.toISOString(),
      updatedAt: supplier.updatedAt.toISOString(),
      linkedCustomersCount: stats.linkedCustomersCount,
      lastLinkedAt: stats.lastLinkedAt?.toISOString() ?? null,
      shipmentUsageCount: stats.shipmentUsageCount,
      lastShipmentUsedAt: stats.lastShipmentUsedAt?.toISOString() ?? null,
    }
  }

  private buildDisplayName(
    firstName: string | null,
    lastName: string | null,
    businessName: string | null,
  ): string {
    return (
      (firstName && lastName && `${firstName} ${lastName}`) ||
      firstName ||
      businessName ||
      'Supplier'
    )
  }

  private normalizeNullableText(value?: string | null): string | null {
    if (value === undefined || value === null) return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private async findUserByEmailHash(emailHash: string) {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.emailHash, emailHash))
      .limit(1)

    return existingUser ?? null
  }

  private async ensureUserSupplierLink(input: {
    userId: string
    supplierId: string
    linkedByUserId?: string | null
  }): Promise<SupplierLinkResult> {
    const now = new Date()
    const [inserted] = await db
      .insert(userSuppliers)
      .values({
        userId: input.userId,
        supplierId: input.supplierId,
        linkedByUserId: input.linkedByUserId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [userSuppliers.userId, userSuppliers.supplierId],
      })
      .returning({ createdAt: userSuppliers.createdAt })

    if (inserted) {
      return { linkedNow: true, linkedAt: inserted.createdAt }
    }

    const [existing] = await db
      .select({ createdAt: userSuppliers.createdAt })
      .from(userSuppliers)
      .where(
        and(
          eq(userSuppliers.userId, input.userId),
          eq(userSuppliers.supplierId, input.supplierId),
        ),
      )
      .limit(1)

    await db
      .update(userSuppliers)
      .set({
        updatedAt: now,
        linkedByUserId: input.linkedByUserId ?? null,
      })
      .where(
        and(
          eq(userSuppliers.userId, input.userId),
          eq(userSuppliers.supplierId, input.supplierId),
        ),
      )

    return {
      linkedNow: false,
      linkedAt: existing?.createdAt ?? now,
    }
  }

  private async getUserSupplierUsage(userId: string, supplierId: string) {
    const [usage] = await db
      .select({
        usageCount: sql<number>`count(${orderPackages.id})::int`,
        lastUsedAt: sql<Date | null>`max(${orderPackages.arrivalAt})`,
      })
      .from(orderPackages)
      .innerJoin(orders, eq(orders.id, orderPackages.orderId))
      .where(
        and(
          eq(orders.senderId, userId),
          eq(orderPackages.supplierId, supplierId),
          isNull(orders.deletedAt),
        ),
      )

    return {
      usageCount: usage?.usageCount ?? 0,
      lastUsedAt: usage?.lastUsedAt ?? null,
    }
  }

  private decryptUser(user: typeof users.$inferSelect) {
    return {
      ...user,
      email: decrypt(user.email),
      firstName: user.firstName ? decrypt(user.firstName) : null,
      lastName: user.lastName ? decrypt(user.lastName) : null,
      businessName: user.businessName ? decrypt(user.businessName) : null,
      phone: user.phone ? decrypt(user.phone) : null,
      whatsappNumber: user.whatsappNumber ? decrypt(user.whatsappNumber) : null,
      shippingMark: user.shippingMark ? decrypt(user.shippingMark) : null,
      addressStreet: user.addressStreet ? decrypt(user.addressStreet) : null,
      // city/state/country/postalCode are stored plain
      notifyEmailAlerts: user.notifyEmailAlerts,
      notifySmsAlerts: user.notifySmsAlerts,
      notifyInAppAlerts: user.notifyInAppAlerts,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      deletedAt: user.deletedAt?.toISOString() ?? null,
    }
  }
}

export const usersService = new UsersService()
