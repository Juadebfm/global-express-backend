import { eq, and, isNull, sql, desc, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { bulkShipments, bulkShipmentItems, users } from '../../drizzle/schema'
import { encrypt, decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { generateTrackingNumber } from '../utils/tracking'
import { broadcastToUser } from '../websocket/handlers'
import { sendOrderStatusUpdateEmail } from '../notifications/email'
import { sendOrderStatusWhatsApp } from '../notifications/whatsapp'
import { mapLegacyStatusToV2 } from '../domain/shipment-v2/status-mapping'
import type { PaginationParams } from '../types'
import { OrderStatus, ShipmentStatusV2 } from '../types/enums'

export interface CreateBulkItemInput {
  customerId: string
  recipientName: string
  recipientAddress: string
  recipientPhone: string
  recipientEmail?: string
  weight?: string
  declaredValue?: string
  description?: string
}

export interface CreateBulkOrderInput {
  origin: string
  destination: string
  notes?: string
  createdBy: string
  items: CreateBulkItemInput[]
}

export class BulkOrdersService {
  async createBulkOrder(input: CreateBulkOrderInput) {
    const initialStatusV2 = mapLegacyStatusToV2(OrderStatus.PENDING, null)

    const [bulk] = await db
      .insert(bulkShipments)
      .values({
        trackingNumber: generateTrackingNumber(),
        origin: input.origin,
        destination: input.destination,
        statusV2: initialStatusV2,
        notes: input.notes ?? null,
        createdBy: input.createdBy,
      })
      .returning()

    const itemValues = input.items.map((item) => ({
      bulkShipmentId: bulk.id,
      customerId: item.customerId,
      trackingNumber: generateTrackingNumber(),
      recipientName: encrypt(item.recipientName),
      recipientAddress: encrypt(item.recipientAddress),
      recipientPhone: encrypt(item.recipientPhone),
      recipientEmail: item.recipientEmail ? encrypt(item.recipientEmail) : null,
      weight: item.weight ?? null,
      declaredValue: item.declaredValue ?? null,
      description: item.description ?? null,
      statusV2: initialStatusV2,
      customerStatusV2: initialStatusV2,
    }))

    const items = await db.insert(bulkShipmentItems).values(itemValues).returning()

    return {
      ...bulk,
      createdAt: bulk.createdAt.toISOString(),
      updatedAt: bulk.updatedAt.toISOString(),
      deletedAt: bulk.deletedAt?.toISOString() ?? null,
      items: items.map((i) => this.decryptItem(i)),
    }
  }

  async getBulkOrderById(id: string) {
    const [bulk] = await db
      .select()
      .from(bulkShipments)
      .where(and(eq(bulkShipments.id, id), isNull(bulkShipments.deletedAt)))
      .limit(1)

    if (!bulk) return null

    const items = await db
      .select()
      .from(bulkShipmentItems)
      .where(eq(bulkShipmentItems.bulkShipmentId, id))
      .orderBy(bulkShipmentItems.createdAt)

    return {
      ...bulk,
      createdAt: bulk.createdAt.toISOString(),
      updatedAt: bulk.updatedAt.toISOString(),
      deletedAt: bulk.deletedAt?.toISOString() ?? null,
      items: items.map((i) => this.decryptItem(i)),
    }
  }

  async getBulkItemByTrackingNumber(trackingNumber: string) {
    const [result] = await db
      .select({
        id: bulkShipmentItems.id,
        trackingNumber: bulkShipmentItems.trackingNumber,
        statusV2: bulkShipmentItems.statusV2,
        createdAt: bulkShipmentItems.createdAt,
        updatedAt: bulkShipmentItems.updatedAt,
        origin: bulkShipments.origin,
        destination: bulkShipments.destination,
      })
      .from(bulkShipmentItems)
      .innerJoin(bulkShipments, eq(bulkShipmentItems.bulkShipmentId, bulkShipments.id))
      .where(eq(bulkShipmentItems.trackingNumber, trackingNumber))
      .limit(1)

    return result ?? null
  }

  async listBulkOrders(params: PaginationParams) {
    const offset = getPaginationOffset(params.page, params.limit)
    const baseWhere = isNull(bulkShipments.deletedAt)

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(bulkShipments)
        .where(baseWhere)
        .orderBy(desc(bulkShipments.createdAt))
        .limit(params.limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(bulkShipments).where(baseWhere),
    ])

    const total = countResult[0]?.count ?? 0
    const bulkIds = data.map((b) => b.id)

    const itemCounts = bulkIds.length
      ? await db
          .select({
            bulkShipmentId: bulkShipmentItems.bulkShipmentId,
            count: sql<number>`count(*)::int`,
          })
          .from(bulkShipmentItems)
          .where(inArray(bulkShipmentItems.bulkShipmentId, bulkIds))
          .groupBy(bulkShipmentItems.bulkShipmentId)
      : []

    const countMap = Object.fromEntries(itemCounts.map((r) => [r.bulkShipmentId, r.count]))

    const result = data.map((bulk) => ({
      ...bulk,
      createdAt: bulk.createdAt.toISOString(),
      updatedAt: bulk.updatedAt.toISOString(),
      deletedAt: bulk.deletedAt?.toISOString() ?? null,
      itemCount: countMap[bulk.id] ?? 0,
    }))

    return buildPaginatedResult(result, total, params)
  }

  async updateBulkOrderStatus(id: string, statusV2: ShipmentStatusV2) {
    const [updated] = await db
      .update(bulkShipments)
      .set({
        statusV2,
        updatedAt: new Date(),
      })
      .where(and(eq(bulkShipments.id, id), isNull(bulkShipments.deletedAt)))
      .returning()

    if (!updated) return null

    // Auto-sync all items
    await db
      .update(bulkShipmentItems)
      .set({
        statusV2,
        customerStatusV2: statusV2,
        updatedAt: new Date(),
      })
      .where(eq(bulkShipmentItems.bulkShipmentId, id))

    // Notify each customer (fire-and-forget)
    const itemsWithCustomers = await db
      .select({
        customerId: bulkShipmentItems.customerId,
        trackingNumber: bulkShipmentItems.trackingNumber,
        recipientName: bulkShipmentItems.recipientName,
        customerEmail: users.email,
        customerPhone: users.phone,
        notifyEmailAlerts: users.notifyEmailAlerts,
        notifySmsAlerts: users.notifySmsAlerts,
        notifyInAppAlerts: users.notifyInAppAlerts,
      })
      .from(bulkShipmentItems)
      .innerJoin(users, eq(bulkShipmentItems.customerId, users.id))
      .where(eq(bulkShipmentItems.bulkShipmentId, id))

    const templateKey = `order.${statusV2.toLowerCase()}`

    for (const item of itemsWithCustomers) {
      if (item.notifyInAppAlerts) {
        broadcastToUser(item.customerId, {
          type: 'order:status_updated',
          data: { trackingNumber: item.trackingNumber, statusV2 },
        })
      }

      const recipientName = decrypt(item.recipientName)
      const customerEmail = decrypt(item.customerEmail)

      if (item.notifyEmailAlerts) {
        sendOrderStatusUpdateEmail({
          to: customerEmail,
          recipientName,
          trackingNumber: item.trackingNumber,
          status: statusV2,
          templateKey,
        }).catch((err) => console.error('Failed to send bulk status email', err))
      }

      if (item.customerPhone && item.notifySmsAlerts) {
        sendOrderStatusWhatsApp({
          phone: decrypt(item.customerPhone),
          recipientName,
          trackingNumber: item.trackingNumber,
          status: statusV2,
        }).catch((err) => console.error('Failed to send bulk status WhatsApp', err))
      }
    }

    return this.getBulkOrderById(id)
  }

  async addItemToBulkOrder(bulkId: string, item: CreateBulkItemInput) {
    const [bulk] = await db
      .select()
      .from(bulkShipments)
      .where(and(eq(bulkShipments.id, bulkId), isNull(bulkShipments.deletedAt)))
      .limit(1)

    if (!bulk) return null

    const [newItem] = await db
      .insert(bulkShipmentItems)
      .values({
        bulkShipmentId: bulkId,
        customerId: item.customerId,
        trackingNumber: generateTrackingNumber(),
        recipientName: encrypt(item.recipientName),
        recipientAddress: encrypt(item.recipientAddress),
        recipientPhone: encrypt(item.recipientPhone),
        recipientEmail: item.recipientEmail ? encrypt(item.recipientEmail) : null,
        weight: item.weight ?? null,
        declaredValue: item.declaredValue ?? null,
        description: item.description ?? null,
      })
      .returning()

    return this.decryptItem(newItem)
  }

  async removeItemFromBulkOrder(bulkId: string, itemId: string) {
    const [deleted] = await db
      .delete(bulkShipmentItems)
      .where(
        and(eq(bulkShipmentItems.id, itemId), eq(bulkShipmentItems.bulkShipmentId, bulkId)),
      )
      .returning({ id: bulkShipmentItems.id })

    return deleted ?? null
  }

  async softDeleteBulkOrder(id: string) {
    const [deleted] = await db
      .update(bulkShipments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(bulkShipments.id, id), isNull(bulkShipments.deletedAt)))
      .returning({ id: bulkShipments.id })

    return deleted ?? null
  }

  private decryptItem(item: typeof bulkShipmentItems.$inferSelect) {
    return {
      ...item,
      recipientName: decrypt(item.recipientName),
      recipientAddress: decrypt(item.recipientAddress),
      recipientPhone: decrypt(item.recipientPhone),
      recipientEmail: item.recipientEmail ? decrypt(item.recipientEmail) : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }
  }
}

export const bulkOrdersService = new BulkOrdersService()
