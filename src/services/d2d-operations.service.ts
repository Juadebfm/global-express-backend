import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../config/db'
import { env } from '../config/env'
import {
  invoiceAttachments,
  invoices,
  orderPackages,
  orders,
  shipmentMeasurements,
} from '../../drizzle/schema'
import {
  InvoiceAttachmentType,
  MeasurementCheckpoint,
  ShipmentType,
  UserRole,
} from '../types/enums'
import { uploadsService } from './uploads.service'

const MAX_PDF_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_FILES_PER_INVOICE = 10

const ALLOWED_TASK_INVOICE_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export class D2dOperationsService {
  private async getOrderOrThrow(orderId: string) {
    const [order] = await db
      .select({
        id: orders.id,
        shipmentType: orders.shipmentType,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1)

    if (!order) {
      throw new Error('Shipment not found.')
    }
    return order
  }

  async upsertMeasurement(params: {
    orderId: string
    checkpoint: MeasurementCheckpoint
    measuredWeightKg: number
    measuredCbm: number
    notes?: string
    measuredBy: string
  }) {
    if (params.measuredWeightKg <= 0 || params.measuredCbm <= 0) {
      throw new Error('Both measuredWeightKg and measuredCbm must be positive values.')
    }

    const order = await this.getOrderOrThrow(params.orderId)
    if (order.shipmentType !== ShipmentType.D2D) {
      throw new Error('Checkpoint measurement recording is currently supported for D2D shipments only.')
    }

    const [skMeasurement] = await db
      .select({
        measuredWeightKg: shipmentMeasurements.measuredWeightKg,
        measuredCbm: shipmentMeasurements.measuredCbm,
      })
      .from(shipmentMeasurements)
      .where(
        and(
          eq(shipmentMeasurements.orderId, params.orderId),
          eq(shipmentMeasurements.checkpoint, MeasurementCheckpoint.SK_WAREHOUSE),
        ),
      )
      .limit(1)

    const skWeight = toNumber(skMeasurement?.measuredWeightKg)
    const skCbm = toNumber(skMeasurement?.measuredCbm)

    const deltaWeight =
      params.checkpoint === MeasurementCheckpoint.SK_WAREHOUSE || skWeight === null
        ? 0
        : round(params.measuredWeightKg - skWeight, 3)
    const deltaCbm =
      params.checkpoint === MeasurementCheckpoint.SK_WAREHOUSE || skCbm === null
        ? 0
        : round(params.measuredCbm - skCbm, 6)

    const [saved] = await db
      .insert(shipmentMeasurements)
      .values({
        orderId: params.orderId,
        checkpoint: params.checkpoint,
        measuredWeightKg: params.measuredWeightKg.toFixed(3),
        measuredCbm: params.measuredCbm.toFixed(6),
        deltaFromSkWeightKg: deltaWeight.toFixed(3),
        deltaFromSkCbm: deltaCbm.toFixed(6),
        measuredBy: params.measuredBy,
        notes: params.notes ?? null,
        measuredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [shipmentMeasurements.orderId, shipmentMeasurements.checkpoint],
        set: {
          measuredWeightKg: params.measuredWeightKg.toFixed(3),
          measuredCbm: params.measuredCbm.toFixed(6),
          deltaFromSkWeightKg: deltaWeight.toFixed(3),
          deltaFromSkCbm: deltaCbm.toFixed(6),
          measuredBy: params.measuredBy,
          notes: params.notes ?? null,
          measuredAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning()

    return {
      ...saved,
      measuredAt: saved.measuredAt.toISOString(),
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    }
  }

  async listMeasurements(orderId: string) {
    await this.getOrderOrThrow(orderId)

    const rows = await db
      .select()
      .from(shipmentMeasurements)
      .where(eq(shipmentMeasurements.orderId, orderId))
      .orderBy(desc(shipmentMeasurements.measuredAt))

    return rows.map((row) => ({
      ...row,
      measuredAt: row.measuredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  private async getInvoiceContextOrThrow(invoiceId: string) {
    const [invoice] = await db
      .select({
        id: invoices.id,
        orderId: invoices.orderId,
        billToUserId: invoices.billToUserId,
        billToSupplierId: invoices.billToSupplierId,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)

    if (!invoice) throw new Error('Invoice not found.')
    return invoice
  }

  private async isSupplierLinkedToOrder(orderId: string, supplierId: string): Promise<boolean> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderPackages)
      .where(
        and(
          eq(orderPackages.orderId, orderId),
          eq(orderPackages.supplierId, supplierId),
        ),
      )
    return (row?.count ?? 0) > 0
  }

  private validateAttachmentInput(params: {
    contentType: string
    fileSizeBytes: number
  }) {
    if (!ALLOWED_TASK_INVOICE_CONTENT_TYPES.has(params.contentType)) {
      throw new Error('Unsupported content type for task invoice attachment.')
    }
    const isPdf = params.contentType === 'application/pdf'
    if (isPdf && params.fileSizeBytes > MAX_PDF_BYTES) {
      throw new Error('PDF file exceeds 5MB limit.')
    }
    if (!isPdf && params.fileSizeBytes > MAX_IMAGE_BYTES) {
      throw new Error('Image file exceeds 12MB upload limit.')
    }
  }

  private async assertAttachmentPermission(params: {
    invoice: {
      id: string
      orderId: string
      billToSupplierId: string | null
    }
    actorRole: UserRole
    actorId: string
    attachmentType: InvoiceAttachmentType
  }) {
    if (params.actorRole === UserRole.STAFF || params.actorRole === UserRole.SUPER_ADMIN) {
      return
    }

    if (params.actorRole !== UserRole.SUPPLIER) {
      throw new Error('Forbidden')
    }

    if (params.attachmentType === InvoiceAttachmentType.TASK_INVOICE) {
      if (params.invoice.billToSupplierId !== params.actorId) {
        throw new Error('Forbidden')
      }
      return
    }

    const linked = await this.isSupplierLinkedToOrder(params.invoice.orderId, params.actorId)
    if (!linked && params.invoice.billToSupplierId !== params.actorId) {
      throw new Error('Forbidden')
    }
  }

  async generateInvoiceAttachmentPresign(params: {
    invoiceId: string
    attachmentType: InvoiceAttachmentType
    contentType: string
    fileSizeBytes: number
    originalFileName?: string
    actorRole: UserRole
    actorId: string
  }) {
    this.validateAttachmentInput({
      contentType: params.contentType,
      fileSizeBytes: params.fileSizeBytes,
    })

    const invoice = await this.getInvoiceContextOrThrow(params.invoiceId)
    await this.assertAttachmentPermission({
      invoice,
      actorRole: params.actorRole,
      actorId: params.actorId,
      attachmentType: params.attachmentType,
    })

    const [existingCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoiceAttachments)
      .where(
        and(
          eq(invoiceAttachments.invoiceId, params.invoiceId),
          eq(invoiceAttachments.attachmentType, params.attachmentType),
        ),
      )

    if ((existingCount?.count ?? 0) >= MAX_FILES_PER_INVOICE) {
      throw new Error('Attachment limit reached for this invoice and document group (max 10 files).')
    }

    const presigned = await uploadsService.generateInvoiceAttachmentPresignedUrl({
      invoiceId: params.invoiceId,
      contentType: params.contentType,
      originalFileName: params.originalFileName,
    })

    return {
      ...presigned,
      limits: {
        maxPdfBytes: MAX_PDF_BYTES,
        maxImageBytes: MAX_IMAGE_BYTES,
        maxFilesPerInvoice: MAX_FILES_PER_INVOICE,
      },
    }
  }

  async confirmInvoiceAttachment(params: {
    invoiceId: string
    attachmentType: InvoiceAttachmentType
    r2Key: string
    contentType: string
    fileSizeBytes: number
    originalFileName: string
    actorRole: UserRole
    actorId: string
  }) {
    this.validateAttachmentInput({
      contentType: params.contentType,
      fileSizeBytes: params.fileSizeBytes,
    })

    const invoice = await this.getInvoiceContextOrThrow(params.invoiceId)
    await this.assertAttachmentPermission({
      invoice,
      actorRole: params.actorRole,
      actorId: params.actorId,
      attachmentType: params.attachmentType,
    })

    const [created] = await db
      .insert(invoiceAttachments)
      .values({
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        attachmentType: params.attachmentType,
        originalFileName: params.originalFileName,
        contentType: params.contentType,
        fileSizeBytes: params.fileSizeBytes,
        r2Key: params.r2Key,
        r2Url: `${env.R2_PUBLIC_URL}/${params.r2Key}`,
        uploadedBy: params.actorId,
      })
      .returning()

    return created
  }

  async listInvoiceAttachments(params: {
    invoiceId: string
    attachmentType: InvoiceAttachmentType
    actorRole: UserRole
    actorId: string
  }) {
    const invoice = await this.getInvoiceContextOrThrow(params.invoiceId)
    await this.assertAttachmentPermission({
      invoice,
      actorRole: params.actorRole,
      actorId: params.actorId,
      attachmentType: params.attachmentType,
    })

    return db
      .select()
      .from(invoiceAttachments)
      .where(
        and(
          eq(invoiceAttachments.invoiceId, params.invoiceId),
          eq(invoiceAttachments.attachmentType, params.attachmentType),
        ),
      )
      .orderBy(desc(invoiceAttachments.createdAt))
  }

  async generateTaskInvoiceAttachmentPresign(params: {
    invoiceId: string
    contentType: string
    fileSizeBytes: number
    originalFileName?: string
    actorRole: UserRole
    actorId: string
  }) {
    return this.generateInvoiceAttachmentPresign({
      ...params,
      attachmentType: InvoiceAttachmentType.TASK_INVOICE,
    })
  }

  async confirmTaskInvoiceAttachment(params: {
    invoiceId: string
    r2Key: string
    contentType: string
    fileSizeBytes: number
    originalFileName: string
    actorRole: UserRole
    actorId: string
  }) {
    return this.confirmInvoiceAttachment({
      ...params,
      attachmentType: InvoiceAttachmentType.TASK_INVOICE,
    })
  }

  async listTaskInvoiceAttachments(params: {
    invoiceId: string
    actorRole: UserRole
    actorId: string
  }) {
    return this.listInvoiceAttachments({
      ...params,
      attachmentType: InvoiceAttachmentType.TASK_INVOICE,
    })
  }
}

export const d2dOperationsService = new D2dOperationsService()
