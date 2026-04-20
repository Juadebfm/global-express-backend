import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { shipmentsController } from '../controllers/shipments.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/requireRole'
import {
  MeasurementCheckpoint,
  OrderDirection,
  ShipmentPayer,
  ShipmentStatusV2,
  ShipmentType,
  TransportMode,
} from '../types/enums'

const shipmentSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string(),
  invoiceId: z.string().uuid().nullable(),
  senderId: z.string().uuid().nullable(),
  senderName: z.string().nullable().describe('Decrypted sender display name'),
  recipientName: z.string(),
  recipientAddress: z.string(),
  recipientPhone: z.string(),
  recipientEmail: z.string().nullable(),
  origin: z.string(),
  destination: z.string(),
  statusV2: z.nativeEnum(ShipmentStatusV2).nullable(),
  statusLabel: z.string().describe('Human-readable status (e.g. "Flight Departed")'),
  orderDirection: z.nativeEnum(OrderDirection),
  weight: z.string().nullable(),
  declaredValue: z.string().nullable(),
  description: z.string().nullable(),
  shipmentType: z.nativeEnum(ShipmentType).nullable(),
  packageCount: z.number().int(),
  departureDate: z.string().nullable(),
  eta: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const goodsInputSchema = z.object({
  supplierId: z.string().uuid(),
  description: z.string().optional(),
  itemType: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  lengthCm: z.number().positive().optional(),
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  weightKg: z.number().positive().optional(),
  cbm: z.number().positive().optional(),
  itemCostUsd: z.number().positive().optional(),
})

export async function shipmentsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/', {
    preHandler: [authenticate],
    schema: {
      tags: ['Shipments'],
      summary: 'List shipments (FE-friendly shape)',
      description: `Returns a paginated list of shipments with FE-friendly fields: decrypted PII, \`statusLabel\`, \`senderName\`, and \`packageCount\`.

**Role gating:**
- Customers see their own orders only.
- Staff / Admin / Superadmin see all orders and can filter by \`senderId\` or \`status\`.`,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number'),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100)'),
        statusV2: z.nativeEnum(ShipmentStatusV2).optional().describe('Filter by V2 shipment status'),
        senderId: z.string().uuid().optional().describe('Filter by customer UUID (staff+ only)'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(shipmentSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.list,
  })

  app.post('/intake', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Shipments — Staff'],
      summary: 'Intake goods and append to open customer shipment',
      description:
        'Appends goods to the current open customer shipment for mode+batch, or creates one if none exists.',
      security: [{ bearerAuth: [] }],
      body: z
        .object({
          customerId: z.string().uuid(),
          mode: z.nativeEnum(TransportMode),
          shipmentType: z.nativeEnum(ShipmentType).optional(),
          shipmentPayer: z.nativeEnum(ShipmentPayer).optional().default(ShipmentPayer.USER),
          billingSupplierId: z.string().uuid().optional(),
          goods: z.array(goodsInputSchema).min(1),
        })
        .superRefine((value, ctx) => {
          if (value.shipmentPayer === ShipmentPayer.SUPPLIER && !value.billingSupplierId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['billingSupplierId'],
              message: 'billingSupplierId is required when shipmentPayer is SUPPLIER',
            })
          }
        }),
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.any(),
        }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.intakeGoods,
  })

  app.put('/:id/measurements', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Shipments — Staff'],
      summary: 'Record or update shipment measurement checkpoint (D2D)',
      security: [{ bearerAuth: [] }],
      params: z.object({
        id: z.string().uuid(),
      }),
      body: z.object({
        checkpoint: z.nativeEnum(MeasurementCheckpoint),
        measuredWeightKg: z.number().positive(),
        measuredCbm: z.number().positive(),
        notes: z.string().optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.any() }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.upsertMeasurement,
  })

  app.get('/:id/measurements', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Shipments — Staff'],
      summary: 'List shipment measurement checkpoints (D2D)',
      security: [{ bearerAuth: [] }],
      params: z.object({
        id: z.string().uuid(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.array(z.any()) }),
        400: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.listMeasurements,
  })

  app.post('/invoices/:invoiceId/task-invoice/presign', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Shipments — Staff'],
      summary: 'Generate presigned upload URL for supplier task-invoice attachment',
      security: [{ bearerAuth: [] }],
      params: z.object({
        invoiceId: z.string().uuid(),
      }),
      body: z.object({
        contentType: z.enum(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
        fileSizeBytes: z.number().int().positive(),
        originalFileName: z.string().min(1).optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.any() }),
        400: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.presignTaskInvoiceAttachment,
  })

  app.post('/invoices/:invoiceId/task-invoice/confirm', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Shipments — Staff'],
      summary: 'Confirm uploaded supplier task-invoice attachment',
      security: [{ bearerAuth: [] }],
      params: z.object({
        invoiceId: z.string().uuid(),
      }),
      body: z.object({
        r2Key: z.string().min(1),
        contentType: z.enum(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
        fileSizeBytes: z.number().int().positive(),
        originalFileName: z.string().min(1),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: z.any() }),
        400: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.confirmTaskInvoiceAttachment,
  })

  app.get('/invoices/:invoiceId/task-invoice', {
    preHandler: [authenticate],
    schema: {
      tags: ['Shipments'],
      summary: 'List supplier task-invoice attachments',
      security: [{ bearerAuth: [] }],
      params: z.object({
        invoiceId: z.string().uuid(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.array(z.any()) }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.listTaskInvoiceAttachments,
  })

  app.post('/invoices/:invoiceId/reg-docs/presign', {
    preHandler: [authenticate],
    schema: {
      tags: ['Shipments'],
      summary: 'Generate presigned upload URL for regulated document',
      security: [{ bearerAuth: [] }],
      params: z.object({
        invoiceId: z.string().uuid(),
      }),
      body: z.object({
        contentType: z.enum(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
        fileSizeBytes: z.number().int().positive(),
        originalFileName: z.string().min(1).optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.any() }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.presignRegulatedDocument,
  })

  app.post('/invoices/:invoiceId/reg-docs/confirm', {
    preHandler: [authenticate],
    schema: {
      tags: ['Shipments'],
      summary: 'Confirm uploaded regulated document',
      security: [{ bearerAuth: [] }],
      params: z.object({
        invoiceId: z.string().uuid(),
      }),
      body: z.object({
        r2Key: z.string().min(1),
        contentType: z.enum(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
        fileSizeBytes: z.number().int().positive(),
        originalFileName: z.string().min(1),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: z.any() }),
        400: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.confirmRegulatedDocument,
  })

  app.get('/invoices/:invoiceId/reg-docs', {
    preHandler: [authenticate],
    schema: {
      tags: ['Shipments'],
      summary: 'List regulated documents linked to an invoice',
      security: [{ bearerAuth: [] }],
      params: z.object({
        invoiceId: z.string().uuid(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.array(z.any()) }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.listRegulatedDocuments,
  })

  app.get('/internal-track/:masterTrackingNumber', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Shipments — Staff'],
      summary: 'Internal tracking by master dispatch tracking number',
      security: [{ bearerAuth: [] }],
      params: z.object({
        masterTrackingNumber: z.string().min(1),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.any() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.internalTrackByMasterTracking,
  })

  app.post('/batches/:batchId/approve-cutoff', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Shipments — Staff'],
      summary: 'Approve pending cutoff and close dispatch batch (superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({
        batchId: z.string().uuid(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.any() }),
        404: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: shipmentsController.approveCutoff,
  })
}
