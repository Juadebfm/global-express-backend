import { eq, and, isNull, sql, desc } from 'drizzle-orm'
import { db } from '../config/db'
import { users, orders, payments } from '../../drizzle/schema'
import { decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'
import { UserRole } from '../types/enums'

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

  private formatClient(
    row: {
      id: string
      email: string
      firstName: string | null
      lastName: string | null
      businessName: string | null
      phone: string | null
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
