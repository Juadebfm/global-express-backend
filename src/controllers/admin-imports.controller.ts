import type { FastifyReply, FastifyRequest } from 'fastify'
import { bulkImportService } from '../services/bulk-import.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import { UserRole } from '../types/enums'

const ALLOWED_IMPORT_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
])

const ALLOWED_IMPORT_EXTENSIONS = ['.csv']

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.trim().toLowerCase()
  return ALLOWED_IMPORT_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export const adminImportsController = {
  async importUsersAndSuppliers(
    request: FastifyRequest<{ Querystring: { dryRun?: boolean } }>,
    reply: FastifyReply,
  ) {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        message: 'Expected multipart/form-data with a file field.',
      })
    }

    const file = await request.file()
    if (!file) {
      return reply.code(400).send({
        success: false,
        message: 'No file found. Upload a CSV (.csv) file in the file field.',
      })
    }

    const supportedType =
      ALLOWED_IMPORT_MIME_TYPES.has(file.mimetype) || hasAllowedExtension(file.filename)

    if (!supportedType) {
      return reply.code(400).send({
        success: false,
        message: 'Unsupported file type. Upload CSV (.csv).',
      })
    }

    const buffer = await file.toBuffer()
    if (buffer.length === 0) {
      return reply.code(400).send({
        success: false,
        message: 'Uploaded file is empty.',
      })
    }

    const dryRun = request.query.dryRun === true
    const result = await bulkImportService.importUsersAndSuppliers({
      buffer,
      actorRole: request.user.role as UserRole,
      dryRun,
    })

    await createAuditLog({
      userId: request.user.id,
      action: dryRun
        ? 'Ran dry-run bulk import for users and suppliers'
        : 'Executed bulk import for users and suppliers',
      resourceType: 'user',
      request,
      metadata: {
        dryRun,
        fileName: file.filename,
        fileMimeType: file.mimetype,
        summary: result.summary,
      },
    })

    return reply.code(dryRun ? 200 : 201).send(successResponse(result))
  },
}
