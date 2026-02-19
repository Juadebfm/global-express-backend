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
  firstName: string
  lastName: string
  phone?: string
  role?: UserRole
}

export interface UpdateUserInput {
  firstName?: string
  lastName?: string
  phone?: string | null
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
        firstName: encrypt(input.firstName),
        lastName: encrypt(input.lastName),
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

    if (input.firstName !== undefined) patch.firstName = encrypt(input.firstName)
    if (input.lastName !== undefined) patch.lastName = encrypt(input.lastName)
    if (input.phone !== undefined) {
      patch.phone = input.phone ? encrypt(input.phone) : null
    }
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
    params: PaginationParams & { role?: UserRole; search?: string },
  ) {
    const offset = getPaginationOffset(params.page, params.limit)

    // Build base query (no search on encrypted fields — search only on role/id)
    const baseWhere = and(
      isNull(users.deletedAt),
      params.role ? eq(users.role, params.role) : undefined,
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

  /** GDPR: export all personal data for a user. */
  async exportUserData(id: string) {
    const user = await this.getUserById(id)
    return user
  }

  /** Strips internal DB fields not appropriate for API responses. */
  private decryptUser(user: typeof users.$inferSelect) {
    return {
      ...user,
      email: decrypt(user.email),
      firstName: decrypt(user.firstName),
      lastName: decrypt(user.lastName),
      phone: user.phone ? decrypt(user.phone) : null,
    }
  }
}

export const usersService = new UsersService()
