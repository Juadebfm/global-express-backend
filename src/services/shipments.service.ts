import { eq, and, isNull, sql, desc } from 'drizzle-orm'
import { db } from '../config/db'
import { orders, users } from '../../drizzle/schema'
import { decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import type { PaginationParams } from '../types'
import type { OrderStatus } from '../types/enums'

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned to Sender',
}

export class ShipmentsService {
  /**
   * Paginated shipments list with decrypted PII, statusLabel, senderName, and packageCount.
   * - Customers: their own orders only.
   * - Staff/Admin/Superadmin: all orders (optionally filtered by senderId or status).
   */
  async list(params: PaginationParams & {
    userId: string
    isCustomer: boolean
    status?: OrderStatus
    senderId?: string
    search?: string
  }) {
    const offset = getPaginationOffset(params.page, params.limit)

    const senderFilter = params.isCustomer
      ? eq(orders.senderId, params.userId)
      : params.senderId
        ? eq(orders.senderId, params.senderId)
        : undefined

    const statusFilter = params.status ? eq(orders.status, params.status) : undefined

    const baseWhere = and(isNull(orders.deletedAt), senderFilter, statusFilter)

    const [rows, countResult] = await Promise.all([
      db
        .select({
          // Order fields
          id: orders.id,
          trackingNumber: orders.trackingNumber,
          senderId: orders.senderId,
          recipientName: orders.recipientName,
          recipientAddress: orders.recipientAddress,
          recipientPhone: orders.recipientPhone,
          recipientEmail: orders.recipientEmail,
          origin: orders.origin,
          destination: orders.destination,
          status: orders.status,
          orderDirection: orders.orderDirection,
          weight: orders.weight,
          declaredValue: orders.declaredValue,
          description: orders.description,
          shipmentType: orders.shipmentType,
          priority: orders.priority,
          packageCount: orders.packageCount,
          departureDate: orders.departureDate,
          eta: orders.eta,
          createdBy: orders.createdBy,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
          // Sender fields (joined)
          senderFirstName: users.firstName,
          senderLastName: users.lastName,
          senderBusinessName: users.businessName,
        })
        .from(orders)
        .leftJoin(users, eq(users.id, orders.senderId))
        .where(baseWhere)
        .orderBy(desc(orders.createdAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(baseWhere),
    ])

    const total = countResult[0]?.count ?? 0

    const data = rows.map((row) => {
      const firstName = row.senderFirstName ? decrypt(row.senderFirstName) : null
      const lastName = row.senderLastName ? decrypt(row.senderLastName) : null
      const businessName = row.senderBusinessName ? decrypt(row.senderBusinessName) : null

      let senderName: string | null = null
      if (firstName && lastName) senderName = `${firstName} ${lastName}`
      else if (firstName) senderName = firstName
      else if (businessName) senderName = businessName

      return {
        id: row.id,
        trackingNumber: row.trackingNumber,
        senderId: row.senderId,
        senderName,
        recipientName: decrypt(row.recipientName),
        recipientAddress: decrypt(row.recipientAddress),
        recipientPhone: decrypt(row.recipientPhone),
        recipientEmail: row.recipientEmail ? decrypt(row.recipientEmail) : null,
        origin: row.origin,
        destination: row.destination,
        status: row.status,
        statusLabel: STATUS_LABELS[row.status] ?? row.status,
        orderDirection: row.orderDirection,
        weight: row.weight,
        declaredValue: row.declaredValue,
        description: row.description,
        shipmentType: row.shipmentType,
        priority: row.priority,
        packageCount: row.packageCount,
        departureDate: row.departureDate?.toISOString() ?? null,
        eta: row.eta?.toISOString() ?? null,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    })

    return buildPaginatedResult(data, total, params)
  }
}

export const shipmentsService = new ShipmentsService()
