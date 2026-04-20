import { describe, expect, it, vi } from 'vitest'
import {
  requireSuperAdmin,
  requireAdminOrAbove,
  requireStaffOrAbove,
} from '../../src/middleware/requireRole'
import { UserRole } from '../../src/types/enums'

function createReply() {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn(),
  } as any
}

describe('requireRole middleware guards', () => {
  it('requireStaffOrAbove allows staff/superadmin', async () => {
    for (const role of [UserRole.STAFF, UserRole.SUPER_ADMIN]) {
      const reply = createReply()
      const request = { user: { role } } as any

      await requireStaffOrAbove(request, reply)

      expect(reply.code).not.toHaveBeenCalled()
      expect(reply.send).not.toHaveBeenCalled()
    }
  })

  it('requireStaffOrAbove blocks user/supplier roles', async () => {
    for (const role of [UserRole.USER, UserRole.SUPPLIER]) {
      const reply = createReply()
      const request = { user: { role } } as any

      await requireStaffOrAbove(request, reply)

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(reply.send).toHaveBeenCalledWith({
        success: false,
        message: 'Forbidden — you do not have permission to access this resource',
      })
    }
  })

  it('requireAdminOrAbove allows staff/superadmin', async () => {
    for (const role of [UserRole.STAFF, UserRole.SUPER_ADMIN]) {
      const reply = createReply()
      const request = { user: { role } } as any

      await requireAdminOrAbove(request, reply)

      expect(reply.code).not.toHaveBeenCalled()
      expect(reply.send).not.toHaveBeenCalled()
    }
  })

  it('requireAdminOrAbove blocks user/supplier', async () => {
    for (const role of [UserRole.USER, UserRole.SUPPLIER]) {
      const reply = createReply()
      const request = { user: { role } } as any

      await requireAdminOrAbove(request, reply)

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(reply.send).toHaveBeenCalled()
    }
  })

  it('requireSuperAdmin allows only superadmin', async () => {
    const denyRoles = [UserRole.USER, UserRole.SUPPLIER, UserRole.STAFF]
    for (const role of denyRoles) {
      const reply = createReply()
      const request = { user: { role } } as any
      await requireSuperAdmin(request, reply)
      expect(reply.code).toHaveBeenCalledWith(403)
    }

    const reply = createReply()
    const request = { user: { role: UserRole.SUPER_ADMIN } } as any
    await requireSuperAdmin(request, reply)
    expect(reply.code).not.toHaveBeenCalled()
  })
})
