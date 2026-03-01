import { eq, asc } from 'drizzle-orm'
import { db } from '../config/db'
import { orderStatusEvents } from '../../drizzle/schema'
import { ShipmentStatusV2 } from '../types/enums'

interface RecordOrderStatusEventInput {
  orderId: string
  status: ShipmentStatusV2
  actorId: string
}

export class OrderStatusEventsService {
  async record(input: RecordOrderStatusEventInput): Promise<void> {
    await db.insert(orderStatusEvents).values({
      orderId: input.orderId,
      status: input.status,
      actorId: input.actorId,
    })
  }

  async getByOrderId(orderId: string) {
    return db
      .select({
        id: orderStatusEvents.id,
        status: orderStatusEvents.status,
        actorId: orderStatusEvents.actorId,
        createdAt: orderStatusEvents.createdAt,
      })
      .from(orderStatusEvents)
      .where(eq(orderStatusEvents.orderId, orderId))
      .orderBy(asc(orderStatusEvents.createdAt))
  }
}

export const orderStatusEventsService = new OrderStatusEventsService()
