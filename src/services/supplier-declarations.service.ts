import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { supplierDeclarations, users, orders } from '../../drizzle/schema'
import { decrypt, encrypt } from '../utils/encryption'
import { generateTrackingNumber } from '../utils/tracking'
import { ShipmentStatusV2, UserRole } from '../types/enums'
import { notifyUser } from './notifications.service'
import { notificationsService } from './notifications.service'
import { sendNewDeclarationAlertEmail } from '../notifications/email'

function safeDecrypt(val: string | null): string | null {
  if (!val) return null
  try { return decrypt(val) } catch { return null }
}

function mapDeclaration(d: typeof supplierDeclarations.$inferSelect) {
  return {
    id: d.id,
    supplierId: d.supplierId,
    recipientName: d.recipientName,
    recipientPhone: d.recipientPhone,
    recipientEmail: d.recipientEmail,
    recipientAddress: d.recipientAddress,
    description: d.description,
    quantity: d.quantity,
    declaredValueUsd: d.declaredValueUsd,
    estimatedWeightKg: d.estimatedWeightKg,
    shipmentType: d.shipmentType,
    specialPackagingNotes: d.specialPackagingNotes,
    supplierNotes: d.supplierNotes,
    estimatedArrivalAt: d.estimatedArrivalAt,
    status: d.status,
    rejectionReason: d.rejectionReason,
    reviewedBy: d.reviewedBy,
    reviewedAt: d.reviewedAt?.toISOString() ?? null,
    orderId: d.orderId,
    linkedCustomerId: d.linkedCustomerId,
    linkedBy: d.linkedBy,
    linkedAt: d.linkedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }
}

export interface SubmitDeclarationInput {
  supplierId: string
  recipientName: string
  recipientPhone: string
  recipientEmail?: string
  recipientAddress?: string
  description: string
  quantity?: number
  declaredValueUsd: number
  estimatedWeightKg?: number
  shipmentType: 'air' | 'ocean' | 'd2d'
  specialPackagingNotes?: string
  supplierNotes?: string
  estimatedArrivalAt?: string
}

class SupplierDeclarationsService {

  async submit(input: SubmitDeclarationInput) {
    const [declaration] = await db
      .insert(supplierDeclarations)
      .values({
        supplierId: input.supplierId,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        recipientEmail: input.recipientEmail ?? null,
        recipientAddress: input.recipientAddress ?? null,
        description: input.description,
        quantity: input.quantity ?? null,
        declaredValueUsd: input.declaredValueUsd.toFixed(2),
        estimatedWeightKg: input.estimatedWeightKg?.toFixed(3) ?? null,
        shipmentType: input.shipmentType,
        specialPackagingNotes: input.specialPackagingNotes ?? null,
        supplierNotes: input.supplierNotes ?? null,
        estimatedArrivalAt: input.estimatedArrivalAt ?? null,
        status: 'pending_review',
      })
      .returning()

    // Notify all staff of the new declaration (fire-and-forget)
    void (async () => {
      try {
        // Look up supplier info for the email
        const [supplier] = await db
          .select({ firstName: users.firstName, lastName: users.lastName, businessName: users.businessName })
          .from(users)
          .where(eq(users.id, input.supplierId))
          .limit(1)

        const safeDecryptField = (v: string | null) => { try { return v ? decrypt(v) : null } catch { return null } }
        const supplierName = [safeDecryptField(supplier?.firstName), safeDecryptField(supplier?.lastName)].filter(Boolean).join(' ') || null
        const supplierBusiness = safeDecryptField(supplier?.businessName ?? null)

        // In-app + WebSocket + push notification to all staff (no generic email — we send a dedicated one below)
        await notificationsService.notifyRole({
          targetRole: UserRole.STAFF,
          type: 'admin_alert',
          title: 'New supplier goods notice',
          body: `${supplierBusiness ?? supplierName ?? 'A supplier'} submitted a goods notice for ${input.recipientName}. Review and accept or reject.`,
          metadata: { declarationId: declaration.id, supplierId: input.supplierId },
          skipEmail: true,
        })

        // Structured email to superadmins
        const superadmins = await db
          .select({ email: users.email })
          .from(users)
          .where(and(inArray(users.role, [UserRole.SUPER_ADMIN]), eq(users.isActive, true), isNull(users.deletedAt)))

        await Promise.allSettled(
          superadmins.map((sa) => {
            try {
              return sendNewDeclarationAlertEmail({
                to: decrypt(sa.email),
                supplierName,
                supplierBusiness,
                description: input.description,
                recipientName: input.recipientName,
                recipientPhone: input.recipientPhone,
                shipmentType: input.shipmentType,
                declaredValueUsd: declaration.declaredValueUsd,
                estimatedWeightKg: declaration.estimatedWeightKg,
                estimatedArrivalAt: input.estimatedArrivalAt ?? null,
                declarationId: declaration.id,
              })
            } catch {
              return Promise.resolve()
            }
          }),
        )
      } catch (err) {
        console.error('[SupplierDeclarations] Failed to send new declaration notifications:', err)
      }
    })()

    return mapDeclaration(declaration)
  }

  async listForSupplier(supplierId: string, params: { page: number; limit: number; status?: string }) {
    const { page, limit } = params
    const conditions = [
      eq(supplierDeclarations.supplierId, supplierId),
      isNull(supplierDeclarations.deletedAt),
    ]
    if (params.status) {
      conditions.push(eq(supplierDeclarations.status, params.status as 'pending_review' | 'accepted' | 'rejected'))
    }

    const rows = await db
      .select()
      .from(supplierDeclarations)
      .where(and(...conditions))
      .orderBy(desc(supplierDeclarations.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return rows.map(mapDeclaration)
  }

  async getForSupplier(id: string, supplierId: string) {
    const [row] = await db
      .select()
      .from(supplierDeclarations)
      .where(and(eq(supplierDeclarations.id, id), eq(supplierDeclarations.supplierId, supplierId), isNull(supplierDeclarations.deletedAt)))
      .limit(1)

    return row ? mapDeclaration(row) : null
  }

  // ── Staff: list all declarations ─────────────────────────────────────────

  async listAll(params: { page: number; limit: number; status?: string; supplierId?: string }) {
    const { page, limit } = params
    const conditions = [isNull(supplierDeclarations.deletedAt)]
    if (params.status) conditions.push(eq(supplierDeclarations.status, params.status as 'pending_review' | 'accepted' | 'rejected'))
    if (params.supplierId) conditions.push(eq(supplierDeclarations.supplierId, params.supplierId))

    const rows = await db
      .select({
        declaration: supplierDeclarations,
        supplierFirstName: users.firstName,
        supplierLastName: users.lastName,
        supplierBusinessName: users.businessName,
      })
      .from(supplierDeclarations)
      .leftJoin(users, eq(supplierDeclarations.supplierId, users.id))
      .where(and(...conditions))
      .orderBy(desc(supplierDeclarations.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return rows.map((r) => ({
      ...mapDeclaration(r.declaration),
      supplierName: [safeDecrypt(r.supplierFirstName), safeDecrypt(r.supplierLastName)].filter(Boolean).join(' ') || null,
      supplierBusinessName: safeDecrypt(r.supplierBusinessName),
    }))
  }

  async getOne(id: string) {
    const [r] = await db
      .select({
        declaration: supplierDeclarations,
        supplierFirstName: users.firstName,
        supplierLastName: users.lastName,
        supplierBusinessName: users.businessName,
      })
      .from(supplierDeclarations)
      .leftJoin(users, eq(supplierDeclarations.supplierId, users.id))
      .where(and(eq(supplierDeclarations.id, id), isNull(supplierDeclarations.deletedAt)))
      .limit(1)

    if (!r) return null
    return {
      ...mapDeclaration(r.declaration),
      supplierName: [safeDecrypt(r.supplierFirstName), safeDecrypt(r.supplierLastName)].filter(Boolean).join(' ') || null,
      supplierBusinessName: safeDecrypt(r.supplierBusinessName),
    }
  }

  // ── Staff: accept — creates a preorder linked to this declaration ─────────

  async accept(id: string, actorId: string) {
    const [decl] = await db
      .select()
      .from(supplierDeclarations)
      .where(and(eq(supplierDeclarations.id, id), isNull(supplierDeclarations.deletedAt)))
      .limit(1)

    if (!decl) return { ok: false as const, reason: 'Declaration not found.' }
    if (decl.status !== 'pending_review') return { ok: false as const, reason: `Declaration is already ${decl.status}.` }

    const trackingNumber = generateTrackingNumber()

    // Create the preorder — senderId is the supplier until a GE customer is linked
    const [order] = await db
      .insert(orders)
      .values({
        senderId: decl.supplierId,
        trackingNumber,
        recipientName: encrypt(decl.recipientName),
        recipientPhone: encrypt(decl.recipientPhone),
        recipientAddress: encrypt(decl.recipientAddress ?? 'Not provided'),
        recipientEmail: decl.recipientEmail ? encrypt(decl.recipientEmail) : null,
        description: decl.description,
        weight: decl.estimatedWeightKg ?? null,
        declaredValue: decl.declaredValueUsd,
        shipmentType: decl.shipmentType,
        transportMode: decl.shipmentType === 'ocean' ? 'sea' : 'air',
        statusV2: ShipmentStatusV2.PREORDER_SUBMITTED,
        customerStatusV2: ShipmentStatusV2.PREORDER_SUBMITTED,
        orderDirection: 'outbound',
        origin: 'South Korea',
        destination: 'Nigeria',
        isPreorder: true,
        billingSupplierId: decl.supplierId,
        shipmentPayer: 'SUPPLIER',
        createdBy: actorId,
      })
      .returning()

    // Mark declaration accepted
    await db
      .update(supplierDeclarations)
      .set({ status: 'accepted', orderId: order.id, reviewedBy: actorId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(supplierDeclarations.id, id))

    // Notify the supplier
    void notifyUser({
      userId: decl.supplierId,
      type: 'admin_alert',
      title: 'Your goods declaration has been accepted',
      body: `Your declaration for "${decl.description}" has been accepted. Tracking number: ${trackingNumber}. Bring your goods to our warehouse.`,
      metadata: { declarationId: id, orderId: order.id, trackingNumber },
    })

    return { ok: true as const, declarationId: id, orderId: order.id, trackingNumber }
  }

  // ── Staff: reject ─────────────────────────────────────────────────────────

  async reject(id: string, actorId: string, reason: string) {
    const [decl] = await db
      .select()
      .from(supplierDeclarations)
      .where(and(eq(supplierDeclarations.id, id), isNull(supplierDeclarations.deletedAt)))
      .limit(1)

    if (!decl) return { ok: false as const, reason: 'Declaration not found.' }
    if (decl.status !== 'pending_review') return { ok: false as const, reason: `Declaration is already ${decl.status}.` }

    await db
      .update(supplierDeclarations)
      .set({ status: 'rejected', rejectionReason: reason, reviewedBy: actorId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(supplierDeclarations.id, id))

    // Notify the supplier
    void notifyUser({
      userId: decl.supplierId,
      type: 'admin_alert',
      title: 'Your goods declaration was not accepted',
      body: `Your declaration for "${decl.description}" was not accepted. Reason: ${reason}. Please fix and resubmit.`,
      metadata: { declarationId: id },
    })

    return { ok: true as const }
  }

  // ── Staff: link declaration to an existing GE customer account ────────────

  async linkCustomer(id: string, customerId: string, actorId: string) {
    const [decl] = await db
      .select()
      .from(supplierDeclarations)
      .where(and(eq(supplierDeclarations.id, id), isNull(supplierDeclarations.deletedAt)))
      .limit(1)

    if (!decl) return { ok: false as const, reason: 'Declaration not found.' }

    await db
      .update(supplierDeclarations)
      .set({ linkedCustomerId: customerId, linkedBy: actorId, linkedAt: new Date(), updatedAt: new Date() })
      .where(eq(supplierDeclarations.id, id))

    // If already accepted and an order was created, also update the order's sender_id
    if (decl.orderId) {
      await db
        .update(orders)
        .set({ senderId: customerId, updatedAt: new Date() })
        .where(eq(orders.id, decl.orderId))
    }

    return { ok: true as const }
  }
}

export const supplierDeclarationsService = new SupplierDeclarationsService()
