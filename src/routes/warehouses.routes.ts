import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { errorResponseSchema } from '../utils/problem-details'
import { warehousesController } from '../controllers/warehouses.controller'
import { authenticate } from '../middleware/authenticate'
import { requireStaffOrAbove, requireSuperAdmin } from '../middleware/requireRole'

const warehouseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  city: z.string(),
  country: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function warehousesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/', {
    preHandler: [authenticate, requireStaffOrAbove],
    schema: {
      tags: ['Warehouses'],
      summary: 'List warehouses (staff+)',
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        includeInactive: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional()
          .describe('Include inactive warehouses (default: false)'),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: z.array(warehouseSchema) }),
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
    handler: warehousesController.listWarehouses,
  })

  app.post('/', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Warehouses'],
      summary: 'Create a warehouse (superadmin)',
      security: [{ bearerAuth: [] }],
      body: z.object({
        name: z.string().min(1).describe('Warehouse name'),
        city: z.string().min(1).describe('City where the warehouse is located'),
        country: z.string().optional().describe('Country code (default: CN)'),
      }),
      response: {
        201: z.object({ success: z.literal(true), data: warehouseSchema }),
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
    handler: warehousesController.createWarehouse,
  })

  app.patch('/:id', {
    preHandler: [authenticate, requireSuperAdmin],
    schema: {
      tags: ['Warehouses'],
      summary: 'Update a warehouse (superadmin)',
      security: [{ bearerAuth: [] }],
      params: z.object({ id: z.string().uuid().describe('Warehouse UUID') }),
      body: z.object({
        name: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
      response: {
        200: z.object({ success: z.literal(true), data: warehouseSchema }),
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
    handler: warehousesController.updateWarehouse,
  })
}
