import type { FastifyRequest, FastifyReply } from 'fastify'
import { shipmentsService } from '../services/shipments.service'
import { dispatchBatchesService } from '../services/dispatch-batches.service'
import { d2dOperationsService } from '../services/d2d-operations.service'
import { successResponse } from '../utils/response'
import { createAuditLog } from '../utils/audit'
import {
  InvoiceAttachmentType,
  MeasurementCheckpoint,
  ShipmentPayer,
  ShipmentStatusV2,
  ShipmentType,
  TransportMode,
  UserRole,
} from '../types/enums'

export const shipmentsController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string
        limit?: string
        statusV2?: string
        senderId?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    const userRole = request.user.role as UserRole

    const result = await shipmentsService.list({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      userId: request.user.id,
      viewerRole: userRole,
      statusV2: request.query.statusV2 as ShipmentStatusV2 | undefined,
      senderId: userRole === UserRole.USER || userRole === UserRole.SUPPLIER
        ? undefined
        : request.query.senderId,
    })

    return reply.send(successResponse(result))
  },

  async intakeGoods(
    request: FastifyRequest<{
      Body: {
        customerId: string
        mode: TransportMode
        shipmentType?: ShipmentType
        shipmentPayer?: ShipmentPayer
        billingSupplierId?: string
        goods: Array<{
          supplierId: string
          description?: string
          itemType?: string
          quantity?: number
          lengthCm?: number
          widthCm?: number
          heightCm?: number
          weightKg?: number
          cbm?: number
          itemCostUsd?: number
        }>
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await dispatchBatchesService.intakeGoods({
        customerId: request.body.customerId,
        mode: request.body.mode,
        shipmentType: request.body.shipmentType,
        shipmentPayer: request.body.shipmentPayer,
        billingSupplierId: request.body.billingSupplierId,
        createdBy: request.user.id,
        goods: request.body.goods,
      })

      await createAuditLog({
        userId: request.user.id,
        action: `Intake goods for customer ${request.body.customerId} into batch ${result.batch.id}`,
        resourceType: 'shipment_intake',
        resourceId: result.shipment.id,
        request,
        metadata: {
          batchId: result.batch.id,
          mode: request.body.mode,
          shipmentType: request.body.shipmentType,
          shipmentPayer: request.body.shipmentPayer,
          goodsCount: result.appendedGoodsCount,
        },
      })

      return reply.code(201).send(successResponse(result))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Shipment intake failed'
      return reply.code(400).send({ success: false, message })
    }
  },

  async internalTrackByMasterTracking(
    request: FastifyRequest<{ Params: { masterTrackingNumber: string } }>,
    reply: FastifyReply,
  ) {
    const payload = await dispatchBatchesService.getInternalTrackingByMasterTracking(
      request.params.masterTrackingNumber,
    )

    if (!payload) {
      return reply.code(404).send({ success: false, message: 'Dispatch batch not found' })
    }

    return reply.send(successResponse(payload))
  },

  async approveCutoff(
    request: FastifyRequest<{ Params: { batchId: string } }>,
    reply: FastifyReply,
  ) {
    const updated = await dispatchBatchesService.approveCutoff(
      request.params.batchId,
      request.user.id,
    )

    if (!updated) {
      return reply.code(404).send({ success: false, message: 'Open/pending batch not found' })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Approved cutoff for dispatch batch ${request.params.batchId}`,
      resourceType: 'dispatch_batch',
      resourceId: request.params.batchId,
      request,
      metadata: { status: updated.status },
    })

    return reply.send(successResponse(updated))
  },

  async upsertMeasurement(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        checkpoint: MeasurementCheckpoint
        measuredWeightKg: number
        measuredCbm: number
        notes?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const saved = await d2dOperationsService.upsertMeasurement({
        orderId: request.params.id,
        checkpoint: request.body.checkpoint,
        measuredWeightKg: request.body.measuredWeightKg,
        measuredCbm: request.body.measuredCbm,
        notes: request.body.notes,
        measuredBy: request.user.id,
      })
      return reply.send(successResponse(saved))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to record measurement.'
      return reply.code(400).send({ success: false, message })
    }
  },

  async listMeasurements(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const rows = await d2dOperationsService.listMeasurements(request.params.id)
      return reply.send(successResponse(rows))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to fetch measurements.'
      return reply.code(400).send({ success: false, message })
    }
  },

  async presignTaskInvoiceAttachment(
    request: FastifyRequest<{
      Params: { invoiceId: string }
      Body: {
        contentType: string
        fileSizeBytes: number
        originalFileName?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const payload = await d2dOperationsService.generateTaskInvoiceAttachmentPresign({
        invoiceId: request.params.invoiceId,
        contentType: request.body.contentType,
        fileSizeBytes: request.body.fileSizeBytes,
        originalFileName: request.body.originalFileName,
        actorRole: request.user.role as UserRole,
        actorId: request.user.id,
      })
      return reply.send(successResponse(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to generate attachment upload URL.'
      return reply.code(400).send({ success: false, message })
    }
  },

  async confirmTaskInvoiceAttachment(
    request: FastifyRequest<{
      Params: { invoiceId: string }
      Body: {
        r2Key: string
        contentType: string
        fileSizeBytes: number
        originalFileName: string
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const payload = await d2dOperationsService.confirmTaskInvoiceAttachment({
        invoiceId: request.params.invoiceId,
        r2Key: request.body.r2Key,
        contentType: request.body.contentType,
        fileSizeBytes: request.body.fileSizeBytes,
        originalFileName: request.body.originalFileName,
        actorRole: request.user.role as UserRole,
        actorId: request.user.id,
      })
      return reply.code(201).send(successResponse(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to confirm invoice attachment upload.'
      return reply.code(400).send({ success: false, message })
    }
  },

  async listTaskInvoiceAttachments(
    request: FastifyRequest<{ Params: { invoiceId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const payload = await d2dOperationsService.listTaskInvoiceAttachments({
        invoiceId: request.params.invoiceId,
        actorRole: request.user.role as UserRole,
        actorId: request.user.id,
      })
      return reply.send(successResponse(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to fetch task invoice attachments.'
      const statusCode = message === 'Forbidden' ? 403 : 400
      return reply.code(statusCode).send({ success: false, message })
    }
  },

  async presignRegulatedDocument(
    request: FastifyRequest<{
      Params: { invoiceId: string }
      Body: {
        contentType: string
        fileSizeBytes: number
        originalFileName?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const payload = await d2dOperationsService.generateInvoiceAttachmentPresign({
        invoiceId: request.params.invoiceId,
        attachmentType: InvoiceAttachmentType.REGULATED_DOCUMENT,
        contentType: request.body.contentType,
        fileSizeBytes: request.body.fileSizeBytes,
        originalFileName: request.body.originalFileName,
        actorRole: request.user.role as UserRole,
        actorId: request.user.id,
      })
      return reply.send(successResponse(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to generate document upload URL.'
      const statusCode = message === 'Forbidden' ? 403 : 400
      return reply.code(statusCode).send({ success: false, message })
    }
  },

  async confirmRegulatedDocument(
    request: FastifyRequest<{
      Params: { invoiceId: string }
      Body: {
        r2Key: string
        contentType: string
        fileSizeBytes: number
        originalFileName: string
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const payload = await d2dOperationsService.confirmInvoiceAttachment({
        invoiceId: request.params.invoiceId,
        attachmentType: InvoiceAttachmentType.REGULATED_DOCUMENT,
        r2Key: request.body.r2Key,
        contentType: request.body.contentType,
        fileSizeBytes: request.body.fileSizeBytes,
        originalFileName: request.body.originalFileName,
        actorRole: request.user.role as UserRole,
        actorId: request.user.id,
      })
      return reply.code(201).send(successResponse(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to confirm regulated document upload.'
      const statusCode = message === 'Forbidden' ? 403 : 400
      return reply.code(statusCode).send({ success: false, message })
    }
  },

  async listRegulatedDocuments(
    request: FastifyRequest<{ Params: { invoiceId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const payload = await d2dOperationsService.listInvoiceAttachments({
        invoiceId: request.params.invoiceId,
        attachmentType: InvoiceAttachmentType.REGULATED_DOCUMENT,
        actorRole: request.user.role as UserRole,
        actorId: request.user.id,
      })
      return reply.send(successResponse(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to fetch regulated documents.'
      const statusCode = message === 'Forbidden' ? 403 : 400
      return reply.code(statusCode).send({ success: false, message })
    }
  },
}
