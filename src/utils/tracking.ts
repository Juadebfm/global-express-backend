import { randomBytes } from 'crypto'

/**
 * Generates a unique shipment tracking number.
 * Format: GEX-YYYYMMDD-XXXXXXXX (e.g. GEX-20260219-A3F9C21B)
 */
export function generateTrackingNumber(): string {
  const date = new Date()
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, '')
  const randomPart = randomBytes(4).toString('hex').toUpperCase()
  return `GEX-${datePart}-${randomPart}`
}
