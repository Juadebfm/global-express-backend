import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { shipmentsController } from '../controllers/shipments.controller'
import { authenticate } from '../middleware/authenticate'
import { ShipmentStatusV2, ShipmentType, OrderDirection } from '../types/enums'

const shipmentSchema = z.object({
  id: z.string().uuid(),
  trackingNumber: z.string(),
  senderId: z.string().uuid(),
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
}
