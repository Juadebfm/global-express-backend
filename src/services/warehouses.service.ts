import { asc, eq } from 'drizzle-orm'
import { db } from '../config/db'
import { warehouses } from '../../drizzle/schema'

export class WarehousesService {
  async listWarehouses(includeInactive?: boolean) {
    const query = db.select().from(warehouses)
    if (!includeInactive) {
      query.where(eq(warehouses.isActive, true))
    }
    return query.orderBy(asc(warehouses.name))
  }

  async createWarehouse(input: { name: string; city: string; country?: string }) {
    const [created] = await db
      .insert(warehouses)
      .values({
        name: input.name,
        city: input.city,
        country: input.country ?? 'CN',
      })
      .returning()
    return created
  }

  async updateWarehouse(
    id: string,
    input: Partial<{ name: string; city: string; country: string; isActive: boolean }>,
  ) {
    const [updated] = await db
      .update(warehouses)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(warehouses.id, id))
      .returning()

    if (!updated) {
      const error = new Error('Warehouse not found') as Error & { statusCode: number }
      error.statusCode = 404
      throw error
    }

    return updated
  }
}

export const warehousesService = new WarehousesService()
