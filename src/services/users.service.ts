import { eq, and, isNull, sql } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { encrypt, decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'
import { UserRole } from '../types/enums'

export interface CreateUserInput {
  clerkId: string
  email: string
  firstName?: string | null
  lastName?: string | null
  businessName?: string | null
  phone?: string
  role?: UserRole
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
  isActive?: boolean
  consentMarketing?: boolean
}

export type UserRecord = Awaited<ReturnType<UsersService['getUserById']>>

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
        role: input.role ?? UserRole.USER,
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
    if (input.isActive !== undefined) patch.isActive = input.isActive
    if (input.consentMarketing !== undefined) patch.consentMarketing = input.consentMarketing

    const [updated] = await db
      .update(users)
      .set(patch)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning()

    return updated ? this.decryptUser(updated) : null
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

  /** GDPR: export all personal data for a user. */
  async exportUserData(id: string) {
    const user = await this.getUserById(id)
    return user
  }

  /**
   * Returns true if the user has all fields required to place an order:
   *   - At least one of: (firstName + lastName) or businessName
   *   - phone
   *   - all 5 address fields
   */
  isProfileComplete(user: ReturnType<UsersService['decryptUser']>): boolean {
    const hasName = (user.firstName && user.lastName) || user.businessName
    const hasPhone = !!user.phone
    const hasAddress =
      !!user.addressStreet &&
      !!user.addressCity &&
      !!user.addressState &&
      !!user.addressCountry &&
      !!user.addressPostalCode

    return !!(hasName && hasPhone && hasAddress)
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
      addressStreet: user.addressStreet ? decrypt(user.addressStreet) : null,
      // city/state/country/postalCode are stored plain
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      deletedAt: user.deletedAt?.toISOString() ?? null,
    }
  }
}

export const usersService = new UsersService()
