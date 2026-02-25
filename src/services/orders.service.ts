import { eq, and, isNull, sql, desc } from 'drizzle-orm'
import { db } from '../config/db'
import { orders, packageImages, bulkShipmentItems, bulkShipments } from '../../drizzle/schema'
import { encrypt, decrypt } from '../utils/encryption'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { generateTrackingNumber } from '../utils/tracking'
import { broadcastToUser } from '../websocket/handlers'
import { sendOrderStatusUpdateEmail } from '../notifications/email'
import { sendOrderStatusWhatsApp } from '../notifications/whatsapp'
import { notifyUser } from './notifications.service'
import type { PaginationParams } from '../types'
import { OrderStatus } from '../types/enums'

const ORDER_STATUS_TITLES: Record<string, string> = {
  pending:           'Order Received',
  picked_up:         'Order Picked Up',
  in_transit:        'Shipment In Transit',
  out_for_delivery:  'Out for Delivery',
  delivered:         'Order Delivered',
  cancelled:         'Order Cancelled',
  returned:          'Order Returned',
}

const ORDER_STATUS_BODIES: Record<string, (tracking: string) => string> = {
  pending:           (t) => `Your order ${t} has been received and is being processed.`,
  picked_up:         (t) => `Your package ${t} has been picked up and is on its way to the warehouse.`,
  in_transit:        (t) => `Your shipment ${t} is now in transit to its destination.`,
  out_for_delivery:  (t) => `Your package ${t} is out for delivery and should arrive soon.`,
  delivered:         (t) => `Your order ${t} has been delivered successfully.`,
  cancelled:         (t) => `Your order ${t} has been cancelled.`,
  returned:          (t) => `Your order ${t} has been returned to sender.`,
}

export interface CreateOrderInput {
  senderId: string
  recipientName: string
  recipientAddress: string
  recipientPhone: string
  recipientEmail?: string
  origin: string
  destination: string
  orderDirection?: 'outbound' | 'inbound'
  weight?: string
  declaredValue?: string
  description?: string
  shipmentType?: 'air' | 'ocean' | 'road'
  priority?: 'standard' | 'express' | 'economy'
  departureDate?: Date | null
  eta?: Date | null
  createdBy: string
}

export interface UpdateOrderStatusInput {
  status: OrderStatus
  updatedBy: string
  // For notification purposes
  senderEmail?: string
  senderPhone?: string
}

export class OrdersService {
  async createOrder(input: CreateOrderInput) {
    const trackingNumber = generateTrackingNumber()

    const [order] = await db
      .insert(orders)
      .values({
        trackingNumber,
        senderId: input.senderId,
        recipientName: encrypt(input.recipientName),
        recipientAddress: encrypt(input.recipientAddress),
        recipientPhone: encrypt(input.recipientPhone),
        recipientEmail: input.recipientEmail ? encrypt(input.recipientEmail) : null,
        origin: input.origin,
        destination: input.destination,
        orderDirection: input.orderDirection ?? 'outbound',
        weight: input.weight ?? null,
        declaredValue: input.declaredValue ?? null,
        description: input.description ?? null,
        shipmentType: input.shipmentType ?? null,
        priority: input.priority ?? null,
        departureDate: input.departureDate ?? null,
        eta: input.eta ?? null,
        createdBy: input.createdBy,
      })
      .returning()

    return this.decryptOrder(order)
  }

  async getOrderById(id: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1)

    return order ? this.decryptOrder(order) : null
  }

  async getOrderByTrackingNumber(trackingNumber: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.trackingNumber, trackingNumber), isNull(orders.deletedAt)))
      .limit(1)

    return order ? this.decryptOrder(order) : null
  }

  async updateOrderStatus(id: string, input: UpdateOrderStatusInput) {
    const [updated] = await db
      .update(orders)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .returning()

    if (!updated) return null

    const decrypted = this.decryptOrder(updated)

    // Push real-time update to the sender
    broadcastToUser(updated.senderId, {
      type: 'order:status_updated',
      data: {
        orderId: updated.id,
        trackingNumber: updated.trackingNumber,
        status: updated.status,
      },
    })

    // Persist in-app notification for the sender (fire-and-forget)
    notifyUser({
      userId: updated.senderId,
      orderId: updated.id,
      type: 'order_status_update',
      title: ORDER_STATUS_TITLES[input.status] ?? 'Order Updated',
      subtitle: decrypted.trackingNumber,
      body: (ORDER_STATUS_BODIES[input.status] ?? ((t: string) => `Order ${t} has been updated.`))(decrypted.trackingNumber),
      metadata: { orderId: updated.id, trackingNumber: updated.trackingNumber, status: input.status },
    })

    // Send notifications (fire-and-forget — don't let notification failures block the response)
    if (input.senderEmail) {
      sendOrderStatusUpdateEmail({
        to: input.senderEmail,
        recipientName: decrypted.recipientName,
        trackingNumber: decrypted.trackingNumber,
        status: input.status,
      }).catch((err) => {
        console.error('Failed to send status update email', err)
      })
    }

    if (input.senderPhone) {
      sendOrderStatusWhatsApp({
        phone: input.senderPhone,
        recipientName: decrypted.recipientName,
        trackingNumber: decrypted.trackingNumber,
        status: input.status,
      }).catch((err) => {
        console.error('Failed to send WhatsApp status update', err)
      })
    }

    return decrypted
  }

  async listOrders(
    params: PaginationParams & {
      status?: OrderStatus
      senderId?: string
    },
  ) {
    const offset = getPaginationOffset(params.page, params.limit)

    const conditions = [
      isNull(orders.deletedAt),
      params.status ? eq(orders.status, params.status) : undefined,
      params.senderId ? eq(orders.senderId, params.senderId) : undefined,
    ].filter(Boolean)

    const baseWhere = and(...(conditions as NonNullable<(typeof conditions)[0]>[]))

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(orders)
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
    return buildPaginatedResult(
      data.map((o) => this.decryptOrder(o)),
      total,
      params,
    )
  }

  /**
   * Unified customer shipments view — combines solo orders + bulk items for a user.
   * Customers see everything in one list without knowing which is solo vs bulk.
   */
  async getMyShipments(userId: string, params: PaginationParams) {
    // Fetch all solo orders and bulk items for the user in parallel
    const [soloOrders, userBulkItems] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(and(eq(orders.senderId, userId), isNull(orders.deletedAt)))
        .orderBy(desc(orders.createdAt)),
      db
        .select({
          id: bulkShipmentItems.id,
          trackingNumber: bulkShipmentItems.trackingNumber,
          status: bulkShipmentItems.status,
          recipientName: bulkShipmentItems.recipientName,
          recipientAddress: bulkShipmentItems.recipientAddress,
          recipientPhone: bulkShipmentItems.recipientPhone,
          recipientEmail: bulkShipmentItems.recipientEmail,
          weight: bulkShipmentItems.weight,
          declaredValue: bulkShipmentItems.declaredValue,
          description: bulkShipmentItems.description,
          createdAt: bulkShipmentItems.createdAt,
          updatedAt: bulkShipmentItems.updatedAt,
          origin: bulkShipments.origin,
          destination: bulkShipments.destination,
        })
        .from(bulkShipmentItems)
        .innerJoin(bulkShipments, eq(bulkShipmentItems.bulkShipmentId, bulkShipments.id))
        .where(
          and(eq(bulkShipmentItems.customerId, userId), isNull(bulkShipments.deletedAt)),
        )
        .orderBy(desc(bulkShipmentItems.createdAt)),
    ])

    const normalizedSolo = soloOrders.map((o) => ({
      type: 'solo' as const,
      id: o.id,
      trackingNumber: o.trackingNumber,
      origin: o.origin,
      destination: o.destination,
      status: o.status,
      orderDirection: o.orderDirection as string,
      recipientName: decrypt(o.recipientName),
      recipientAddress: decrypt(o.recipientAddress),
      recipientPhone: decrypt(o.recipientPhone),
      recipientEmail: o.recipientEmail ? decrypt(o.recipientEmail) : null,
      weight: o.weight,
      declaredValue: o.declaredValue,
      description: o.description,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }))

    const normalizedBulk = userBulkItems.map((item) => ({
      type: 'bulk_item' as const,
      id: item.id,
      trackingNumber: item.trackingNumber,
      origin: item.origin,
      destination: item.destination,
      status: item.status,
      orderDirection: null as string | null,
      recipientName: decrypt(item.recipientName),
      recipientAddress: decrypt(item.recipientAddress),
      recipientPhone: decrypt(item.recipientPhone),
      recipientEmail: item.recipientEmail ? decrypt(item.recipientEmail) : null,
      weight: item.weight,
      declaredValue: item.declaredValue,
      description: item.description,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }))

    // Combine and sort by createdAt descending
    const combined = [...normalizedSolo, ...normalizedBulk].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )

    const total = combined.length
    const offset = getPaginationOffset(params.page, params.limit)
    const data = combined.slice(offset, offset + params.limit)

    return buildPaginatedResult(data, total, params)
  }

  async softDeleteOrder(id: string) {
    const [deleted] = await db
      .update(orders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .returning({ id: orders.id })

    return deleted ?? null
  }

  async getOrderImages(orderId: string) {
    return db
      .select()
      .from(packageImages)
      .where(eq(packageImages.orderId, orderId))
      .orderBy(packageImages.createdAt)
  }

  private decryptOrder(order: typeof orders.$inferSelect) {
    return {
      ...order,
      recipientName: decrypt(order.recipientName),
      recipientAddress: decrypt(order.recipientAddress),
      recipientPhone: decrypt(order.recipientPhone),
      recipientEmail: order.recipientEmail ? decrypt(order.recipientEmail) : null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      deletedAt: order.deletedAt?.toISOString() ?? null,
      departureDate: order.departureDate?.toISOString() ?? null,
      eta: order.eta?.toISOString() ?? null,
    }
  }
}

export const ordersService = new OrdersService()
