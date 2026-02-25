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
  it('requireStaffOrAbove allows staff/admin/superadmin', async () => {
    for (const role of [UserRole.STAFF, UserRole.ADMIN, UserRole.SUPERADMIN]) {
      const reply = createReply()
      const request = { user: { role } } as any

      await requireStaffOrAbove(request, reply)

      expect(reply.code).not.toHaveBeenCalled()
      expect(reply.send).not.toHaveBeenCalled()
    }
  })

  it('requireStaffOrAbove blocks user role', async () => {
    const reply = createReply()
    const request = { user: { role: UserRole.USER } } as any

    await requireStaffOrAbove(request, reply)

    expect(reply.code).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: 'Forbidden — you do not have permission to access this resource',
    })
  })

  it('requireAdminOrAbove blocks staff role', async () => {
    const reply = createReply()
    const request = { user: { role: UserRole.STAFF } } as any

    await requireAdminOrAbove(request, reply)

    expect(reply.code).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalled()
  })

  it('requireSuperAdmin allows only superadmin', async () => {
    const denyRoles = [UserRole.USER, UserRole.STAFF, UserRole.ADMIN]
    for (const role of denyRoles) {
      const reply = createReply()
      const request = { user: { role } } as any
      await requireSuperAdmin(request, reply)
      expect(reply.code).toHaveBeenCalledWith(403)
    }

    const allowReply = createReply()
    const allowRequest = { user: { role: UserRole.SUPERADMIN } } as any
    await requireSuperAdmin(allowRequest, allowReply)
    expect(allowReply.code).not.toHaveBeenCalled()
  })
})
