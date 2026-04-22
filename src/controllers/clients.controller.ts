import type { FastifyRequest, FastifyReply } from 'fastify'
import { clientsService } from '../services/clients.service'
import { ordersService } from '../services/orders.service'
import { usersService } from '../services/users.service'
import { createAuditLog } from '../utils/audit'
import { successResponse } from '../utils/response'
import {
  OrderDirection,
  ShipmentPayer,
  ShipmentType,
  TransportMode,
  UserRole,
  type ShipmentStatusV2,
} from '../types/enums'

function buildFallbackRecipientAddress(client: {
  addressStreet?: string | null
  addressCity?: string | null
  addressState?: string | null
  addressCountry?: string | null
}) {
  const parts = [
    client.addressStreet,
    client.addressCity,
    client.addressState,
    client.addressCountry,
  ]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))

  if (parts.length > 0) return parts.join(', ')
  return 'Global Express Lagos Office (58B Awoniyi Elemo Street, Ajao Estate, Lagos)'
}

export const clientsController = {
  async list(
    request: FastifyRequest<{
      Querystring: { page?: string; limit?: string; isActive?: string }
    }>,
    reply: FastifyReply,
  ) {
    const isActive =
      request.query.isActive === 'true'
        ? true
        : request.query.isActive === 'false'
          ? false
          : undefined

    const result = await clientsService.listClients({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      isActive,
    })

    return reply.send(successResponse(result))
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }
    return reply.send(successResponse(client))
  },

  async listOrders(
    request: FastifyRequest<{
      Params: { id: string }
      Querystring: { page?: string; limit?: string; statusV2?: string }
    }>,
    reply: FastifyReply,
  ) {
    // Verify client exists
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    const result = await ordersService.listOrders({
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 20,
      senderId: request.params.id,
      statusV2: request.query.statusV2 as ShipmentStatusV2 | undefined,
    })

    return reply.send(successResponse(result))
  },

  async getClientWorkbench(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    const [suppliers, recentOrders] = await Promise.all([
      usersService.listMySuppliers({
        userId: request.params.id,
        page: 1,
        limit: 20,
      }),
      ordersService.listOrders({
        page: 1,
        limit: 10,
        senderId: request.params.id,
      }),
    ])

    return reply.send(
      successResponse({
        client,
        suppliers: suppliers.data,
        suppliersPagination: suppliers.pagination,
        recentOrders: recentOrders.data,
        recentOrdersPagination: recentOrders.pagination,
      }),
    )
  },

  async listClientSuppliers(
    request: FastifyRequest<{
      Params: { id: string }
      Querystring: { page?: string; limit?: string; isActive?: boolean }
    }>,
    reply: FastifyReply,
  ) {
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    const result = await usersService.listMySuppliers({
      userId: request.params.id,
      page: Number(request.query.page) || 1,
      limit: Number(request.query.limit) || 50,
      isActive: request.query.isActive,
    })

    return reply.send(successResponse(result))
  },

  async saveClientSupplier(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        supplierId?: string
        email?: string
        firstName?: string | null
        lastName?: string | null
        businessName?: string | null
        phone?: string | null
      }
    }>,
    reply: FastifyReply,
  ) {
    const client = await clientsService.getClientById(request.params.id)
    if (!client) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    const result = await usersService.saveMySupplier({
      userId: request.params.id,
      linkedByUserId: request.user.id,
      supplierId: request.body.supplierId,
      email: request.body.email,
      firstName: request.body.firstName,
      lastName: request.body.lastName,
      businessName: request.body.businessName,
      phone: request.body.phone,
    })

    if (result.status === 'not_found') {
      return reply.code(404).send({ success: false, message: 'Supplier not found' })
    }

    if (result.status === 'forbidden') {
      return reply.code(403).send({ success: false, message: result.message })
    }

    if (result.status === 'conflict') {
      return reply.code(409).send({ success: false, message: result.message })
    }

    await createAuditLog({
      userId: request.user.id,
      action: `Linked supplier for client ${request.params.id}`,
      resourceType: 'user',
      resourceId: request.params.id,
      request,
      metadata: {
        supplierId: result.data.supplier.id,
        createdSupplier: result.data.createdSupplier,
        linkedNow: result.data.linkedNow,
      },
    })

    return reply.send(successResponse(result.data))
  },

  async intakeClientGoods(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        shipmentType?: ShipmentType
        orderDirection?: OrderDirection
        recipientName?: string
        recipientAddress?: string
        recipientPhone?: string
        recipientEmail?: string
        description?: string
        shipmentPayer?: ShipmentPayer
        billingSupplierId?: string
        transportMode?: TransportMode
        departureDate?: string
        packages: Array<{
          supplierId?: string
          arrivalAt?: string
          description?: string
          itemType?: string
          quantity?: number
          lengthCm?: number
          widthCm?: number
          heightCm?: number
          weightKg?: number
          cbm?: number
          itemCostUsd?: number
          requiresExtraTruckMovement?: boolean
          specialPackagingType?: string
          isRestricted?: boolean
          restrictedReason?: string
          restrictedOverrideApproved?: boolean
          restrictedOverrideReason?: string
        }>
      }
    }>,
    reply: FastifyReply,
  ) {
    const client = await usersService.getUserById(request.params.id)
    if (!client || client.role !== UserRole.USER) {
      return reply.code(404).send({ success: false, message: 'Client not found' })
    }

    const hasRestrictedOverride = request.body.packages.some((pkg) => pkg.restrictedOverrideApproved)
    if (hasRestrictedOverride && request.user.role === UserRole.STAFF) {
      return reply.code(403).send({
        success: false,
        message: 'Only superadmin can approve restricted-item overrides.',
      })
    }

    if (!client.phone && !request.body.recipientPhone) {
      return reply.code(422).send({
        success: false,
        message: 'Client has no phone number. Provide recipientPhone for goods intake.',
      })
    }

    const fallbackName =
      [client.firstName, client.lastName].filter((v): v is string => Boolean(v)).join(' ') ||
      client.businessName?.trim() ||
      'Client'

    let createdOrder: Awaited<ReturnType<typeof ordersService.createOrder>> | null = null
    try {
      createdOrder = await ordersService.createOrder({
        senderId: client.id,
        recipientName: request.body.recipientName?.trim() || fallbackName,
        recipientAddress:
          request.body.recipientAddress?.trim() || buildFallbackRecipientAddress(client),
        recipientPhone: request.body.recipientPhone?.trim() || client.phone || '',
        recipientEmail: request.body.recipientEmail?.trim() || client.email,
        orderDirection: request.body.orderDirection ?? OrderDirection.OUTBOUND,
        description: request.body.description?.trim(),
        shipmentType: request.body.shipmentType ?? ShipmentType.AIR,
        shipmentPayer: request.body.shipmentPayer ?? ShipmentPayer.USER,
        billingSupplierId: request.body.billingSupplierId ?? null,
        isPreorder: false,
        createdBy: request.user.id,
      })

      const verified = await ordersService.verifyOrderAtWarehouse(createdOrder.id, {
        verifiedBy: request.user.id,
        transportMode: request.body.transportMode,
        departureDate: request.body.departureDate ? new Date(request.body.departureDate) : undefined,
        packages: request.body.packages.map((pkg) => ({
          ...pkg,
          arrivalAt: pkg.arrivalAt ? new Date(pkg.arrivalAt) : undefined,
        })),
      })

      if (!verified) {
        return reply.code(404).send({ success: false, message: 'Order not found after intake' })
      }

      await createAuditLog({
        userId: request.user.id,
        action: `Created client goods intake for ${request.params.id} (${verified.trackingNumber})`,
        resourceType: 'order',
        resourceId: verified.id,
        request,
        metadata: {
          senderId: request.params.id,
          packageCount: request.body.packages.length,
          shipmentType: request.body.shipmentType ?? ShipmentType.AIR,
        },
      })

      return reply.code(201).send(successResponse(verified))
    } catch (err) {
      if (createdOrder) {
        await ordersService.softDeleteOrder(createdOrder.id)
      }
      const message = err instanceof Error ? err.message : 'Client goods intake failed'
      return reply.code(400).send({ success: false, message })
    }
  },

  async createClient(
    request: FastifyRequest<{
      Body: {
        email: string
        firstName?: string
        lastName?: string
        businessName?: string
        phone?: string
        whatsappNumber?: string
        addressStreet?: string
        addressCity?: string
        addressState?: string
        addressCountry?: string
        addressPostalCode?: string
        shippingMark?: string
        consentMarketing?: boolean
      }
    }>,
    reply: FastifyReply,
  ) {
    const canProvision = await clientsService.canActorProvisionClientLoginLinks(
      request.user.id,
      request.user.role as UserRole,
    )
    if (!canProvision) {
      return reply.code(403).send({
        success: false,
        message:
          'Forbidden — only superadmin or staff granted this privilege can provision client login links.',
      })
    }

    if (
      request.body.shippingMark &&
      request.user.role !== UserRole.SUPER_ADMIN
    ) {
      return reply.code(403).send({
        success: false,
        message: 'Forbidden — only superadmin can set shipping mark during user creation',
      })
    }

    try {
      const provisioned = await clientsService.provisionClientAndShareLoginLink({
        actorRole: request.user.role as UserRole,
        email: request.body.email,
        firstName: request.body.firstName,
        lastName: request.body.lastName,
        businessName: request.body.businessName,
        phone: request.body.phone,
        whatsappNumber: request.body.whatsappNumber,
        addressStreet: request.body.addressStreet,
        addressCity: request.body.addressCity,
        addressState: request.body.addressState,
        addressCountry: request.body.addressCountry,
        addressPostalCode: request.body.addressPostalCode,
        shippingMark: request.body.shippingMark?.trim(),
        consentMarketing: request.body.consentMarketing,
      })

      await createAuditLog({
        userId: request.user.id,
        action: `Provisioned client login link for ${request.body.email}`,
        resourceType: 'user',
        resourceId: provisioned.id,
        request,
        metadata: {
          linkType: provisioned.linkType,
          whatsappNumber: provisioned.whatsappNumber,
          wasExistingClient: provisioned.wasExistingClient,
        },
      })

      return reply.code(201).send(successResponse(provisioned))
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode) || 400
          : 400

      const message = error instanceof Error ? error.message : 'Client provisioning failed'
      return reply.code(statusCode).send({ success: false, message })
    }
  },

  async sendInvite(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { whatsappNumber?: string; phone?: string }
    }>,
    reply: FastifyReply,
  ) {
    const canProvision = await clientsService.canActorProvisionClientLoginLinks(
      request.user.id,
      request.user.role as UserRole,
    )
    if (!canProvision) {
      return reply.code(403).send({
        success: false,
        message:
          'Forbidden — only superadmin or staff granted this privilege can share client login links.',
      })
    }

    try {
      const dispatched = await clientsService.resendClientLoginLink({
        clientId: request.params.id,
        whatsappNumber: request.body?.whatsappNumber,
        phone: request.body?.phone,
      })

      await createAuditLog({
        userId: request.user.id,
        action: `Shared client login link for ${request.params.id}`,
        resourceType: 'user',
        resourceId: request.params.id,
        request,
        metadata: {
          linkType: dispatched.linkType,
          whatsappNumber: dispatched.whatsappNumber,
        },
      })

      return reply.send(successResponse(dispatched))
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode) || 400
          : 400

      const message = error instanceof Error ? error.message : 'Login-link dispatch failed'
      return reply.code(statusCode).send({ success: false, message })
    }
  },
}
