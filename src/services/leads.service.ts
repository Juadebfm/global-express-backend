import { eq, and, desc, count } from 'drizzle-orm'
import { db } from '../config/db'
import { inboundLeads } from '../../drizzle/schema'
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination'
import { notificationsService } from './notifications.service'
import { UserRole } from '../types/enums'

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

export interface D2dIntakeInput {
  fullName: string
  email?: string
  phone?: string
  originCountry: string
  goodsDescription: string
  estimatedWeightKg?: number
  estimatedCbm?: number
  deliveryPhone?: string
  deliveryAddressLine1?: string
  deliveryState?: string
  deliveryCity?: string
  deliveryLandmark?: string
}

class LeadsService {
  async submitD2dIntake(input: D2dIntakeInput, submittedByUserId: string) {
    const metadata: Record<string, unknown> = {
      goodsDescription: input.goodsDescription,
    }
    if (input.estimatedWeightKg !== undefined) metadata.estimatedWeightKg = input.estimatedWeightKg
    if (input.estimatedCbm !== undefined) metadata.estimatedCbm = input.estimatedCbm
    if (input.deliveryPhone) {
      metadata.delivery = {
        phone: input.deliveryPhone,
        addressLine1: input.deliveryAddressLine1 ?? null,
        state: input.deliveryState ?? null,
        city: input.deliveryCity ?? null,
        landmark: input.deliveryLandmark ?? null,
        country: 'Nigeria',
      }
    }

    const [lead] = await db
      .insert(inboundLeads)
      .values({
        leadType: 'd2d_intake',
        status: 'new',
        fullName: input.fullName.trim(),
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone?.trim() ?? null,
        originCountry: input.originCountry.trim(),
        message: input.goodsDescription.trim(),
        userId: submittedByUserId,
        metadata,
      })
      .returning()

    void notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'admin_alert',
      title: 'New D2D intake request',
      body: `${input.fullName.trim()} (${input.originCountry.trim()}) submitted a D2D intake — ${input.goodsDescription.slice(0, 80)}`,
      createdBy: submittedByUserId,
      metadata: { leadId: lead.id },
    })

    return lead
  }

  async listLeads(params: {
    page: number
    limit: number
    leadType?: 'd2d_intake' | 'shop_inquiry'
    status?: 'new' | 'contacted' | 'converted' | 'closed'
    assignedTo?: string
  }) {
    const offset = getPaginationOffset(params.page, params.limit)

    const conditions = [
      params.leadType ? eq(inboundLeads.leadType, params.leadType) : undefined,
      params.status ? eq(inboundLeads.status, params.status) : undefined,
      params.assignedTo ? eq(inboundLeads.assignedTo, params.assignedTo) : undefined,
    ].filter(Boolean)

    const where = conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: inboundLeads.id,
          leadType: inboundLeads.leadType,
          status: inboundLeads.status,
          fullName: inboundLeads.fullName,
          email: inboundLeads.email,
          phone: inboundLeads.phone,
          originCountry: inboundLeads.originCountry,
          message: inboundLeads.message,
          itemId: inboundLeads.itemId,
          assignedTo: inboundLeads.assignedTo,
          userId: inboundLeads.userId,
          convertedAt: inboundLeads.convertedAt,
          createdAt: inboundLeads.createdAt,
          updatedAt: inboundLeads.updatedAt,
        })
        .from(inboundLeads)
        .where(where)
        .orderBy(desc(inboundLeads.createdAt))
        .limit(params.limit)
        .offset(offset),
      db.select({ total: count() }).from(inboundLeads).where(where),
    ])

    return buildPaginatedResult(rows, Number(total), { page: params.page, limit: params.limit })
  }

  async getLead(id: string) {
    const [lead] = await db
      .select()
      .from(inboundLeads)
      .where(eq(inboundLeads.id, id))
      .limit(1)

    if (!lead) throw httpError('Lead not found', 404)
    return lead
  }

  async updateLead(
    id: string,
    patch: {
      status?: 'new' | 'contacted' | 'converted' | 'closed'
      assignedTo?: string | null
      message?: string
    },
  ) {
    const update: Partial<typeof inboundLeads.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (patch.status !== undefined) {
      update.status = patch.status
      if (patch.status === 'converted') update.convertedAt = new Date()
    }
    if (patch.assignedTo !== undefined) update.assignedTo = patch.assignedTo ?? undefined
    if (patch.message !== undefined) update.message = patch.message

    const [updated] = await db
      .update(inboundLeads)
      .set(update)
      .where(eq(inboundLeads.id, id))
      .returning()

    if (!updated) throw httpError('Lead not found', 404)
    return updated
  }

  async deleteLead(id: string): Promise<void> {
    const [deleted] = await db
      .delete(inboundLeads)
      .where(eq(inboundLeads.id, id))
      .returning({ id: inboundLeads.id })

    if (!deleted) throw httpError('Lead not found', 404)
  }

  async getMyD2dLeads(userId: string) {
    return db
      .select()
      .from(inboundLeads)
      .where(
        and(
          eq(inboundLeads.userId, userId),
          eq(inboundLeads.leadType, 'd2d_intake'),
        ),
      )
      .orderBy(desc(inboundLeads.createdAt))
  }

  async submitShopInquiry(
    input: {
      fullName: string
      phone?: string
      email?: string
      message: string
      itemId?: string
    },
    submittedByUserId: string,
  ) {
    const [lead] = await db
      .insert(inboundLeads)
      .values({
        leadType: 'shop_inquiry',
        status: 'new',
        fullName: input.fullName.trim(),
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone?.trim() ?? null,
        message: input.message.trim(),
        itemId: input.itemId ?? null,
        userId: submittedByUserId,
        metadata: null,
      })
      .returning()

    void notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'admin_alert',
      title: 'New shop inquiry',
      body: `${input.fullName.trim()} sent a shop inquiry`,
      createdBy: submittedByUserId,
      metadata: { leadId: lead.id },
    })

    return lead
  }

  async submitGeneralInquiry(input: {
    fullName: string
    email?: string
    phone?: string
    message: string
  }) {
    const [lead] = await db
      .insert(inboundLeads)
      .values({
        leadType: 'general_inquiry',
        status: 'new',
        fullName: input.fullName.trim(),
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone?.trim() ?? null,
        message: input.message.trim(),
      })
      .returning()

    void notificationsService.notifyRole({
      targetRole: UserRole.STAFF,
      type: 'admin_alert',
      title: 'New contact inquiry',
      body: `${input.fullName.trim()} submitted a contact inquiry`,
      metadata: { leadId: lead.id },
    })

    return lead
  }
}

export const leadsService = new LeadsService()
