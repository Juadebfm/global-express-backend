import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { authenticate } from '../middleware/authenticate'
import { requireSupplier } from '../middleware/requireRole'
import { errorResponseSchema } from '../utils/problem-details'
import { supplierDeclarationsService } from '../services/supplier-declarations.service'
import { internalAuthService } from '../services/internal-auth.service'
import { successResponse } from '../utils/response'
import { createAuditLog } from '../utils/audit'
import { UserRole } from '../types/enums'
import { ordersService } from '../services/orders.service'

const declarationSchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  recipientEmail: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  description: z.string(),
  quantity: z.number().nullable(),
  declaredValueUsd: z.string(),
  estimatedWeightKg: z.string().nullable(),
  shipmentType: z.enum(['air', 'ocean', 'd2d']),
  specialPackagingNotes: z.string().nullable(),
  supplierNotes: z.string().nullable(),
  estimatedArrivalAt: z.string().nullable(),
  status: z.enum(['pending_review', 'accepted', 'rejected']),
  rejectionReason: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  orderId: z.string().nullable(),
  linkedCustomerId: z.string().nullable(),
  linkedBy: z.string().nullable(),
  linkedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const errorSchemas = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

export async function supplierRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  // ── Login ─────────────────────────────────────────────────────────────────
  app.post('/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Supplier'],
      summary: 'Supplier login',
      description: 'Authenticates a supplier account using email and password. Returns a JWT access token.',
      body: z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            user: z.object({
              id: z.string(),
              email: z.string(),
              firstName: z.string().nullable(),
              lastName: z.string().nullable(),
              role: z.literal('supplier'),
            }),
            tokens: z.object({ accessToken: z.string() }),
          }),
        }),
        401: errorResponseSchema,
        423: errorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await internalAuthService.validateCredentials(request.body.email, request.body.password)

      if (!result.ok) {
        if (result.reason === 'locked') {
          return reply.code(423).send({ success: false, message: 'Account locked due to too many failed attempts. Try again later.' })
        }
        return reply.code(401).send({ success: false, message: 'Invalid email or password' })
      }

      if (result.user.role !== UserRole.SUPPLIER) {
        return reply.code(401).send({ success: false, message: 'Invalid email or password' })
      }

      const accessToken = internalAuthService.generateToken(result.user.id, result.user.role)

      return reply.send(successResponse({
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: 'supplier' as const,
        },
        tokens: { accessToken },
      }))
    },
  })

  // ── Submit a goods declaration ────────────────────────────────────────────
  app.post('/declarations', {
    preHandler: [authenticate, requireSupplier],
    schema: {
      tags: ['Supplier'],
      summary: 'Submit a goods declaration',
      description: `Tell Global Express about goods you are sending to our warehouse on behalf of a customer.
We will review your declaration and either accept it (you will receive a tracking number) or come back to you with questions.
Once accepted, bring the goods to our warehouse. We handle the rest.`,
      security: [{ bearerAuth: [] }],
      body: z.object({
        recipientName: z.string().min(1).describe('Full name of the customer receiving the goods in Nigeria'),
        recipientPhone: z.string().min(1).describe('Phone number of the customer in Nigeria'),
        recipientEmail: z.string().email().optional().describe('Email of the customer (optional)'),
        recipientAddress: z.string().optional().describe('Delivery address in Nigeria (optional — helps us plan D2D delivery)'),
        description: z.string().min(1).describe('What are the goods? e.g. "500 pieces eyeliner, 200 pieces eyeshadow palette"'),
        quantity: z.number().int().positive().optional().describe('Total number of pieces or units'),
        declaredValueUsd: z.number().positive().describe('Total value of the goods in USD'),
        estimatedWeightKg: z.number().positive().optional().describe('Estimated total weight in kg'),
        shipmentType: z.enum(['air', 'ocean', 'd2d']).describe('How should these goods travel? air = faster, ocean = larger/cheaper, d2d = door-to-door delivery in Nigeria'),
        specialPackagingNotes: z.string().optional().describe('Any fragile, oversized, or special handling requirements'),
        supplierNotes: z.string().optional().describe('Anything else we should know'),
        estimatedArrivalAt: z.string().optional().describe('When do you expect the goods to arrive at our warehouse? (YYYY-MM-DD)'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: declarationSchema }),
        ...errorSchemas,
      },
    },
    handler: async (request, reply) => {
      const declaration = await supplierDeclarationsService.submit({
        supplierId: request.user.id,
        ...request.body,
      })

      await createAuditLog({
        userId: request.user.id,
        action: 'supplier_declaration_submitted',
        resourceType: 'supplier_declaration',
        resourceId: declaration.id,
        request,
        metadata: { shipmentType: request.body.shipmentType, recipientName: request.body.recipientName },
      })

      return reply.code(201).send(successResponse(declaration))
    },
  })

  // ── List my declarations ──────────────────────────────────────────────────
  app.get('/declarations', {
    preHandler: [authenticate, requireSupplier],
    schema: {
      tags: ['Supplier'],
      summary: 'List my declarations',
      description: 'Returns all goods declarations you have submitted, newest first.',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        status: z.enum(['pending_review', 'accepted', 'rejected']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.array(declarationSchema) }),
        ...errorSchemas,
      },
    },
    handler: async (request, reply) => {
      const declarations = await supplierDeclarationsService.listForSupplier(request.user.id, request.query)
      return reply.send(successResponse(declarations))
    },
  })

  // ── Get a single declaration ──────────────────────────────────────────────
  app.get('/declarations/:id', {
    preHandler: [authenticate, requireSupplier],
    schema: {
      tags: ['Supplier'],
      summary: 'Get a single declaration',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({ success: z.literal(true), data: declarationSchema }),
        ...errorSchemas,
      },
    },
    handler: async (request, reply) => {
      const declaration = await supplierDeclarationsService.getForSupplier(request.params.id, request.user.id)
      if (!declaration) return reply.code(404).send({ success: false, message: 'Declaration not found' })
      return reply.send(successResponse(declaration))
    },
  })

  // ── Booking requests (Flow 1) ────────────────────────────────────────────
  app.get('/orders/requests', {
    preHandler: [authenticate, requireSupplier],
    schema: {
      tags: ['Supplier'],
      summary: 'List shipment requests where this supplier has been named by a customer',
      description: 'Returns all orders where a customer has named this supplier account as their sourcing supplier.',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1).describe('Page number'),
        limit: z.coerce.number().int().min(1).max(50).optional().default(20).describe('Results per page (max 50)'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(z.object({
              id: z.string(),
              trackingNumber: z.string(),
              description: z.string().nullable(),
              weight: z.string().nullable(),
              declaredValue: z.string().nullable(),
              shipmentType: z.string().nullable(),
              statusV2: z.string().nullable(),
              sourcingSupplierName: z.string().nullable(),
              sourcingSupplierPhone: z.string().nullable(),
              sourcingSupplierEmail: z.string().nullable(),
              createdAt: z.string(),
              updatedAt: z.string(),
            })),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
        ...errorSchemas,
      },
    },
    handler: async (request, reply) => {
      const requests = await ordersService.getCustomerRequestsForSupplier(request.user.id, {
        page: request.query.page,
        limit: request.query.limit,
      })
      return reply.send(successResponse(requests))
    },
  })
}
