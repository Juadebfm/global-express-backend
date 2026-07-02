import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { orderSurcharges } from '../../drizzle/schema'

class SurchargesService {
  async listSurcharges(orderId: string) {
    return db
      .select()
      .from(orderSurcharges)
      .where(eq(orderSurcharges.orderId, orderId))
      .orderBy(orderSurcharges.createdAt)
  }

  async addSurcharge(input: {
    orderId: string
    type: string
    label: string
    amountUsd: number
    notes?: string
    addedBy: string
  }) {
    const [surcharge] = await db
      .insert(orderSurcharges)
      .values({
        orderId: input.orderId,
        type: input.type as 'BAF' | 'CAF' | 'PSS' | 'FSC' | 'OTHER',
        label: input.label,
        amountUsd: input.amountUsd.toFixed(2),
        notes: input.notes ?? null,
        addedBy: input.addedBy,
      })
      .returning()
    return surcharge
  }

  async removeSurcharge(surchargeId: string): Promise<void> {
    await db
      .delete(orderSurcharges)
      .where(eq(orderSurcharges.id, surchargeId))
  }

  async getSurchargesSumForOrder(orderId: string): Promise<number> {
    const rows = await db
      .select({ amountUsd: orderSurcharges.amountUsd })
      .from(orderSurcharges)
      .where(eq(orderSurcharges.orderId, orderId))
    return rows.reduce((sum, row) => {
      const val = parseFloat(row.amountUsd ?? '0')
      return Number.isFinite(val) ? sum + val : sum
    }, 0)
  }
}

export const surchargesService = new SurchargesService()
