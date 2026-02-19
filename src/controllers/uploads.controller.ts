import type { FastifyRequest, FastifyReply } from 'fastify'
import { uploadsService } from '../services/uploads.service'
import { successResponse } from '../utils/response'

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

export const uploadsController = {
  async generatePresignedUrl(
    request: FastifyRequest<{
      Body: { orderId: string; contentType: string }
    }>,
    reply: FastifyReply,
  ) {
    if (!ALLOWED_CONTENT_TYPES.has(request.body.contentType)) {
      return reply.code(400).send({
        success: false,
        message: `Unsupported content type. Allowed: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`,
      })
    }

    const result = await uploadsService.generatePresignedUrl({
      orderId: request.body.orderId,
      contentType: request.body.contentType,
    })

    return reply.send(successResponse(result))
  },

  async confirmUpload(
    request: FastifyRequest<{
      Body: { orderId: string; r2Key: string }
    }>,
    reply: FastifyReply,
  ) {
    const image = await uploadsService.confirmUpload({
      orderId: request.body.orderId,
      r2Key: request.body.r2Key,
      uploadedBy: request.user.id,
    })

    return reply.code(201).send(successResponse(image))
  },

  async getOrderImages(
    request: FastifyRequest<{ Params: { orderId: string } }>,
    reply: FastifyReply,
  ) {
    const images = await uploadsService.getOrderImages(request.params.orderId)
    return reply.send(successResponse(images))
  },

  async deleteImage(
    request: FastifyRequest<{ Params: { imageId: string } }>,
    reply: FastifyReply,
  ) {
    const deleted = await uploadsService.deleteImage(request.params.imageId)

    if (!deleted) {
      return reply.code(404).send({ success: false, message: 'Image not found' })
    }

    return reply.send(successResponse({ message: 'Image deleted successfully' }))
  },
}
