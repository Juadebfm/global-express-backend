import type { FastifyRequest } from 'fastify'
import { verifyToken } from '@clerk/backend'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { env } from '../config/env'

/** Maps DB userId → set of open WebSocket connections for that user. */
// WebSocket type comes from the ws package bundled with @fastify/websocket
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const connectedClients = new Map<string, Set<any>>()

/**
 * WebSocket connection handler.
 * Clients must pass their Clerk JWT as a `token` query parameter since
 * WebSocket upgrades cannot easily include custom headers after the handshake.
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

  let userId: string

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

  // Register the connection
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
    request.log.info({ userId }, 'WebSocket client disconnected')
  })

  socket.on('error', (err: unknown) => {
    request.log.error({ err, userId }, 'WebSocket error')
  })
}

/**
 * Broadcasts a JSON payload to all open sockets for a specific user.
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
