import type { FastifyInstance } from 'fastify'
import { handleWebSocketConnection } from './handlers'

export function registerWebSocketRoutes(app: FastifyInstance): void {
  /**
   * ws://host/ws?token=<clerk_jwt>
   * Clients connect here for real-time shipment status updates.
   */
  app.get('/ws', { websocket: true }, handleWebSocketConnection)
}
