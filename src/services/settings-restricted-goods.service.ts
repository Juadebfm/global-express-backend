import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../config/db'
import { restrictedGoods } from '../../drizzle/schema'

export interface RestrictedGoodUpsertInput {
  id?: string
  code: string
  nameEn: string
  nameKo?: string
  description?: string
  allowWithOverride?: boolean
  isActive?: boolean
}

export interface UpdateRestrictedGoodsInput {
  actorId: string
  items?: RestrictedGoodUpsertInput[]
  deleteIds?: string[]
}

export interface RestrictedGoodsMutationSummary {
  createdIds: string[]
  updatedIds: string[]
  deletedIds: string[]
}

function normalizeCode(code: string): string {
  return code.trim().toLowerCase()
}

export class SettingsRestrictedGoodsService {
  async listRestrictedGoods(includeInactive = false) {
    const where = and(includeInactive ? undefined : eq(restrictedGoods.isActive, true))

    const rows = await db
      .select()
      .from(restrictedGoods)
      .where(where)
      .orderBy(desc(restrictedGoods.updatedAt), desc(restrictedGoods.createdAt))

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async updateRestrictedGoods(
    input: UpdateRestrictedGoodsInput,
  ): Promise<RestrictedGoodsMutationSummary> {
    const summary: RestrictedGoodsMutationSummary = {
      createdIds: [],
      updatedIds: [],
      deletedIds: [],
    }

    await db.transaction(async (tx) => {
      if (input.items) {
        for (const item of input.items) {
          const code = normalizeCode(item.code)

          if (item.id) {
            const [updated] = await tx
              .update(restrictedGoods)
              .set({
                code,
                nameEn: item.nameEn,
                nameKo: item.nameKo ?? null,
                description: item.description ?? null,
                allowWithOverride: item.allowWithOverride ?? true,
                isActive: item.isActive ?? true,
                updatedBy: input.actorId,
                updatedAt: new Date(),
              })
              .where(eq(restrictedGoods.id, item.id))
              .returning({ id: restrictedGoods.id })

            if (!updated) {
              throw new Error(`Restricted good not found: ${item.id}`)
            }

            summary.updatedIds.push(updated.id)
          } else {
            const [created] = await tx
              .insert(restrictedGoods)
              .values({
                code,
                nameEn: item.nameEn,
                nameKo: item.nameKo ?? null,
                description: item.description ?? null,
                allowWithOverride: item.allowWithOverride ?? true,
                isActive: item.isActive ?? true,
                createdBy: input.actorId,
                updatedBy: input.actorId,
              })
              .returning({ id: restrictedGoods.id })

            summary.createdIds.push(created.id)
          }
        }
      }

      if (input.deleteIds && input.deleteIds.length > 0) {
        const deleted = await tx
          .delete(restrictedGoods)
          .where(inArray(restrictedGoods.id, input.deleteIds))
          .returning({ id: restrictedGoods.id })

        summary.deletedIds.push(...deleted.map((row) => row.id))
      }
    })

    return summary
  }
}

export const settingsRestrictedGoodsService = new SettingsRestrictedGoodsService()
