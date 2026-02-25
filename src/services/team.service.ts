import { eq, and, isNull, sql, desc, ne } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'
import { UserRole } from '../types/enums'

// Role → permissions mapping shown in the team panel
const ROLE_PERMISSIONS: Record<string, string[]> = {
  superadmin: ['Manage Users', 'Manage Team', 'View Reports', 'Manage Orders', 'Send Notifications', 'System Settings'],
  admin:       ['Manage Users', 'View Reports', 'Manage Orders', 'Send Notifications'],
  staff:       ['View Reports', 'Manage Orders'],
}

export class TeamService {
  /**
   * Paginated list of internal users (staff, admin, superadmin).
   * Returns decrypted PII + derived permissions array.
   */
  async listTeam(params: PaginationParams & { role?: string; isActive?: boolean }) {
    const offset = getPaginationOffset(params.page, params.limit)

    const baseWhere = and(
      isNull(users.deletedAt),
      // Internal users only — exclude customers
      ne(users.role, UserRole.USER),
      params.role ? eq(users.role, params.role as UserRole) : undefined,
      params.isActive !== undefined ? eq(users.isActive, params.isActive) : undefined,
    )

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(users)
        .where(baseWhere)
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
      data.map((u) => this.formatMember(u)),
      total,
      params,
    )
  }

  private formatMember(user: typeof users.$inferSelect) {
    const firstName = user.firstName ? decrypt(user.firstName) : null
    const lastName  = user.lastName  ? decrypt(user.lastName)  : null

    let displayName: string | null = null
    if (firstName && lastName) displayName = `${firstName} ${lastName}`
    else if (firstName) displayName = firstName
    else if (lastName) displayName = lastName

    return {
      id: user.id,
      email: decrypt(user.email),
      firstName,
      lastName,
      displayName,
      role: user.role,
      isActive: user.isActive,
      permissions: ROLE_PERMISSIONS[user.role] ?? [],
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }
  }
}

export const teamService = new TeamService()
