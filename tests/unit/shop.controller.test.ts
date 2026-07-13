import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserRole } from '../../src/types/enums'

const shopServiceMocks = vi.hoisted(() => ({
  listPublicVehicles: vi.fn(),
  listPublicItems: vi.fn(),
  submitPublicVehicleInquiry: vi.fn(),
  submitAuthenticatedItemInquiry: vi.fn(),
}))

vi.mock('../../src/services/shop.service', () => ({
  shopService: {
    listPublicVehicles: shopServiceMocks.listPublicVehicles,
    listPublicItems: shopServiceMocks.listPublicItems,
    submitPublicVehicleInquiry: shopServiceMocks.submitPublicVehicleInquiry,
    submitAuthenticatedItemInquiry: shopServiceMocks.submitAuthenticatedItemInquiry,
  },
}))

import { shopController } from '../../src/controllers/shop.controller'

function createReply() {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn(),
  } as any
}

describe('shopController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists public vehicles with parsed pagination', async () => {
    const payload = {
      data: [{ id: 'vehicle-1' }],
      pagination: { page: 2, limit: 12, total: 1, totalPages: 1 },
    }
    shopServiceMocks.listPublicVehicles.mockResolvedValue(payload)

    const reply = createReply()
    const request = {
      query: { page: '2', limit: '12' },
    } as any

    await shopController.listPublicVehicles(request, reply)

    expect(shopServiceMocks.listPublicVehicles).toHaveBeenCalledWith({ page: 2, limit: 12 })
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      data: payload,
    })
  })

  it('lists public items with default pagination', async () => {
    const payload = {
      data: [{ id: 'item-1' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }
    shopServiceMocks.listPublicItems.mockResolvedValue(payload)

    const reply = createReply()
    const request = {
      query: {},
    } as any

    await shopController.listPublicItems(request, reply)

    expect(shopServiceMocks.listPublicItems).toHaveBeenCalledWith({ page: 1, limit: 20 })
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      data: payload,
    })
  })

  it('submits a public vehicle inquiry and returns 201', async () => {
    const payload = {
      id: 'interest-1',
      listingId: 'listing-1',
      status: 'new',
      message: 'Need more details',
      createdAt: '2026-07-13T00:00:00.000Z',
      item: { id: 'listing-1' },
    }
    shopServiceMocks.submitPublicVehicleInquiry.mockResolvedValue(payload)

    const reply = createReply()
    const request = {
      params: { listingId: 'listing-1' },
      body: {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+2348012345678',
        city: 'Lagos',
        country: 'Nigeria',
        message: 'Need more details',
      },
    } as any

    await shopController.submitPublicVehicleInquiry(request, reply)

    expect(shopServiceMocks.submitPublicVehicleInquiry).toHaveBeenCalledWith({
      listingId: 'listing-1',
      publicContact: {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+2348012345678',
        city: 'Lagos',
        country: 'Nigeria',
      },
      message: 'Need more details',
    })
    expect(reply.code).toHaveBeenCalledWith(201)
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      data: payload,
    })
  })

  it('blocks internal roles from submitting authenticated item inquiries', async () => {
    const reply = createReply()
    const request = {
      user: {
        id: 'staff-1',
        role: UserRole.STAFF,
        email: 'ops@example.com',
      },
      params: { listingId: 'listing-1' },
      body: { message: 'Check this item' },
    } as any

    await shopController.submitAuthenticatedItemInquiry(request, reply)

    expect(shopServiceMocks.submitAuthenticatedItemInquiry).not.toHaveBeenCalled()
    expect(reply.code).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: 'Internal roles cannot submit shop inquiries.',
    })
  })

  it('submits authenticated customer item inquiries', async () => {
    const payload = {
      id: 'interest-2',
      listingId: 'listing-2',
      status: 'new',
      message: 'Please share availability',
      createdAt: '2026-07-13T00:00:00.000Z',
      item: { id: 'listing-2' },
    }
    shopServiceMocks.submitAuthenticatedItemInquiry.mockResolvedValue(payload)

    const reply = createReply()
    const request = {
      user: {
        id: 'user-1',
        role: UserRole.USER,
        email: 'buyer@example.com',
      },
      params: { listingId: 'listing-2' },
      body: { message: 'Please share availability' },
    } as any

    await shopController.submitAuthenticatedItemInquiry(request, reply)

    expect(shopServiceMocks.submitAuthenticatedItemInquiry).toHaveBeenCalledWith({
      listingId: 'listing-2',
      authClaimant: {
        id: 'user-1',
        role: UserRole.USER,
        fallbackEmail: 'buyer@example.com',
      },
      message: 'Please share availability',
    })
    expect(reply.code).toHaveBeenCalledWith(201)
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      data: payload,
    })
  })
})
