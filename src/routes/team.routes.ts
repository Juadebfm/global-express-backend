import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { teamController } from '../controllers/team.controller'
import { authenticate } from '../middleware/authenticate'
import { requireAdminOrAbove } from '../middleware/requireRole'

const teamMemberSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string().nullable().describe('Derived: firstName + lastName, or null'),
  role: z.enum(['superadmin', 'admin', 'staff']),
  isActive: z.boolean(),
  permissions: z.array(z.string()).describe('Derived list of permission labels for this role'),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export async function teamRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.get('/', {
    preHandler: [authenticate, requireAdminOrAbove],
    schema: {
      tags: ['Team'],
      summary: 'List internal team members (admin+)',
      description: `Returns a paginated list of internal users (staff, admin, superadmin) with decrypted PII and derived permission labels.

Requires **admin** or **superadmin** role.

**Optional filters:**
- \`role\`: filter by specific role (staff | admin | superadmin)
- \`isActive\`: filter by active status`,
      security: [{ bearerAuth: [] }],
      querystring: z.object({
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        role: z.enum(['superadmin', 'admin', 'staff']).optional().describe('Filter by role'),
        isActive: z.enum(['true', 'false']).optional().describe('Filter by active status'),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            data: z.array(teamMemberSchema),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        }),
        401: z.object({ success: z.literal(false), message: z.string() }),
        403: z.object({ success: z.literal(false), message: z.string() }),
      },
    },
    handler: teamController.list,
  })
}
