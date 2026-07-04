import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { errorResponseSchema } from '../utils/problem-details'
import { leadsController } from '../controllers/leads.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove, requireSuperAdmin } from '../middleware/requireRole'

const leadStatusEnum = z.enum(['new', 'contacted', 'converted', 'closed'])
const leadTypeEnum = z.enum(['d2d_intake', 'shop_inquiry'])

const leadSchema = z.object({
  id: z.string().uuid(),
  leadType: leadTypeEnum,
  status: leadStatusEnum,
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  originCountry: z.string().nullable(),
  message: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  assignedTo: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  convertedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function leadsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ── Customer: submit D2D intake ───────────────────────────────────────────

  app.post('/d2d-intake', {
    preHandler: [authenticate],
    schema: {
      tags: ['Leads'],
      summary: 'Submit a D2D intake request (any authenticated user)',
      security: [{ bearerAuth: [] }],
      body: z.object({
        fullName: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        originCountry: z.string().min(1).describe('Country where the goods are located'),
        goodsDescription: z.string().min(10).describe('Description of goods to be shipped'),
        estimatedWeightKg: z.number().positive().optional(),
        estimatedCbm: z.number().positive().optional(),
        deliveryPhone: z.string().optional(),
        deliveryAddressLine1: z.string().optional(),
        deliveryState: z.string().optional(),
        deliveryCity: z.string().optional(),
        deliveryLandmark: z.string().optional(),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: leadSchema }),
        401: errorResponseSchema,
      },
    },
    handler: leadsController.submitD2dIntake,
  })

  // ── Customer: view own D2D leads ──────────────────────────────────────────

  app.get('/my-d2d', {
    preHandler: [authenticate],
    schema: {
      tags: ['Leads'],
      summary: 'List the authenticated user\'s own D2D intake submissions',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({ success: z.literal(true), data: z.array(leadSchema) }),
        401: errorResponseSchema,
      },
    },
    handler: leadsController.getMyD2dLeads,
  })

  // ── Staff: manage all leads ───────────────────────────────────────────────

  app.get('/', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Leads'],
      summary: 'List all inbound leads (staff+)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        leadType: leadTypeEnum.optional(),
        status: leadStatusEnum.optional(),
        assignedTo: z.string().uuid().optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(leadSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
    handler: leadsController.listLeads,
  })

  app.get('/:id', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Leads'],
      summary: 'Get a single lead (staff+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: leadSchema }),
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: leadsController.getLead,
  })

  app.patch('/:id', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Leads'],
      summary: 'Update a lead status, assignment, or notes (staff+)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        status: leadStatusEnum.optional(),
        assignedTo: z.string().uuid().nullable().optional(),
        message: z.string().optional(),
      }).refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' }),
      response: {
        200: z.object({ success: z.literal(true), data: leadSchema }),
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: leadsController.updateLead,
  })

  app.delete('/:id', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Leads'],
      summary: 'Hard-delete a lead (superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: z.object({ deleted: z.literal(true) }) }),
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: leadsController.deleteLead,
  })
}
