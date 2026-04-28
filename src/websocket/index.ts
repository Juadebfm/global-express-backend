import type { FastifyInstance } from 'fastify'
import { handleWebSocketConnection } from './handlers'

export function registerWebSocketRoutes(app: FastifyInstance): void {
  /**
   * ws://host/ws
   * Token must be provided via:
   *   - Authorization: Bearer <jwt>
   *   - Sec-WebSocket-Protocol: bearer, <jwt>
   * Clients connect here for real-time shipment status updates.
   */
  app.get('/ws', { websocket: true }, handleWebSocketConnection)
}
