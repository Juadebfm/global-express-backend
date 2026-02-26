import type { FastifyRequest } from 'fastify'
import { verifyToken } from '@clerk/backend'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { env } from '../config/env'
import { internalAuthService } from '../services/internal-auth.service'

/** Maps DB userId → set of open WebSocket connections for that user. */
// WebSocket type comes from the ws package bundled with @fastify/websocket
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const connectedClients = new Map<string, Set<any>>()

/** Maps ticketId → Set of userIds currently watching that ticket conversation. */
export const ticketRooms = new Map<string, Set<string>>()

/**
 * WebSocket connection handler.
 *
 * Supports two token types via the `token` query parameter:
 *   1. Clerk JWT    — for customers (role: user)
 *   2. Internal JWT — for staff / admin / superadmin
 *
 * Token type is detected by peeking at the `type` claim in the JWT payload
 * (same strategy as the authenticate middleware).
 *
 * Connect: ws://host/ws?token=<jwt>
 */
// Using `any` for the socket type to avoid requiring @types/ws as a direct dependency;
// the ws types are available through @fastify/websocket's peer dependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleWebSocketConnection(
  socket: any,
  request: FastifyRequest,
): Promise<void> {
  const query = request.query as Record<string, string>
  const token = query.token

  if (!token) {
    socket.close(4001, 'Unauthorized — token query parameter is required')
    return
  }

  // ─── Peek at JWT payload to detect token type (no verification yet) ────────
  let tokenType: string | undefined
  try {
    const parts = token.split('.')
    if (parts.length === 3) {
      const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      tokenType = decoded?.type
    }
  } catch {
    // malformed — will fail in the appropriate branch below
  }

  let userId: string

  // ─── Branch 1: Internal JWT (staff / admin / superadmin) ─────────────────
  if (tokenType === 'internal') {
    try {
      const payload = internalAuthService.verifyToken(token)

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)))
        .limit(1)

      if (!user) {
        socket.close(4001, 'Unauthorized — user not found')
        return
      }

      userId = user.id
    } catch {
      socket.close(4001, 'Unauthorized — invalid or expired token')
      return
    }
  } else {
    // ─── Branch 2: Clerk JWT (customers) ─────────────────────────────────────
    try {
      const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY })

      if (!payload?.sub) {
        socket.close(4001, 'Unauthorized — invalid token')
        return
      }

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.clerkId, payload.sub), isNull(users.deletedAt)))
        .limit(1)

      if (!user) {
        socket.close(4001, 'Unauthorized — user not found')
        return
      }

      userId = user.id
    } catch {
      socket.close(4001, 'Authentication failed')
      return
    }
  }

  // ─── Register the connection ───────────────────────────────────────────────
  if (!connectedClients.has(userId)) {
    connectedClients.set(userId, new Set())
  }
  connectedClients.get(userId)!.add(socket)

  request.log.info({ userId }, 'WebSocket client connected')

  socket.send(JSON.stringify({ type: 'connected', message: 'Real-time connection established' }))

  socket.on('close', () => {
    const sockets = connectedClients.get(userId)
    sockets?.delete(socket)
    if (sockets?.size === 0) {
      connectedClients.delete(userId)
    }
    // Clean up any ticket rooms this user was watching
    for (const [ticketId, userIds] of ticketRooms) {
      userIds.delete(userId)
      if (userIds.size === 0) ticketRooms.delete(ticketId)
    }
    request.log.info({ userId }, 'WebSocket client disconnected')
  })

  socket.on('message', (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'support:join' && typeof msg.ticketId === 'string') {
        if (!ticketRooms.has(msg.ticketId)) ticketRooms.set(msg.ticketId, new Set())
        ticketRooms.get(msg.ticketId)!.add(userId)
      } else if (msg.type === 'support:leave' && typeof msg.ticketId === 'string') {
        ticketRooms.get(msg.ticketId)?.delete(userId)
        if (ticketRooms.get(msg.ticketId)?.size === 0) ticketRooms.delete(msg.ticketId)
      }
    } catch {
      // ignore malformed messages
    }
  })

  socket.on('error', (err: unknown) => {
    request.log.error({ err, userId }, 'WebSocket error')
  })
}

/**
 * Broadcasts a JSON payload to every open WebSocket connection (all users).
 * Used for system-wide announcements.
 */
export function broadcastToAll(data: unknown): void {
  const message = JSON.stringify(data)
  for (const [, sockets] of connectedClients) {
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message)
      }
    }
  }
}

/**
 * Broadcasts to all users currently watching a specific support ticket room.
 * No-ops silently if no one is watching the ticket.
 */
export function broadcastToTicket(ticketId: string, data: unknown): void {
  const userIds = ticketRooms.get(ticketId)
  if (!userIds || userIds.size === 0) return
  for (const uid of userIds) {
    broadcastToUser(uid, data)
  }
}

/**
 * Broadcasts a JSON payload to all open sockets for a specific user.
 * No-ops silently if the user has no active connections.
 */
export function broadcastToUser(userId: string, data: unknown): void {
  const sockets = connectedClients.get(userId)
  if (!sockets || sockets.size === 0) return

  const message = JSON.stringify(data)

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message)
    }
  }
}
