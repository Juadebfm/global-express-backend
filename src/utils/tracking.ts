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

/**
 * Masks a tracking number for public display.
 * Example: GEX-20260219-A3F9C21B -> GEX-20260219-****C21B
 */
export function maskTrackingNumber(trackingNumber: string): string {
  const match = trackingNumber.match(/^([A-Z]+-\d{8}-)([A-Z0-9]{8})$/)
  if (match) {
    const [, prefix, tail] = match
    return `${prefix}****${tail.slice(-4)}`
  }

  const trimmed = trackingNumber.trim()
  if (trimmed.length <= 4) return '****'
  return `****${trimmed.slice(-4)}`
}
