import { randomBytes } from 'crypto'

/**
 * Generates an internal-only reference at order creation time.
 * Never shown to customers — they use their slot tracking number (YYYYMMDD-NNNN)
 * which is assigned when their order is placed into a dispatch batch.
 */
export function generateTrackingNumber(): string {
  return `TEMP-${randomBytes(8).toString('hex').toUpperCase()}`
}

/**
 * Generates the customer-facing tracking number for a batch slot.
 * Format: YYYYMMDD-NNNN (e.g. 20260615-0020)
 * Date is the batch creation date; position is the customer's sequential slot number in this batch.
 */
export function generateSlotTrackingNumber(batchCreatedAt: Date, position: number): string {
  const d = batchCreatedAt
  const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  const pos = String(position).padStart(4, '0')
  return `${date}-${pos}`
}

/**
 * Generates the internal batch master tracking number.
 * Format: AIR-YYYYMMDD-NNNN or SEA-YYYYMMDD-NNNN
 * Date is the batch creation date; yearSequence is how many batches of this mode exist this calendar year (including this one).
 */
export function generateMasterTrackingNumber(mode: 'air' | 'sea', batchCreatedAt: Date, yearSequence: number): string {
  const prefix = mode.toUpperCase()
  const d = batchCreatedAt
  const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  const seq = String(yearSequence).padStart(4, '0')
  return `${prefix}-${date}-${seq}`
}

/**
 * Masks a tracking number for public display.
 * New format (YYYYMMDD-NNNN):   20260615-0020 → 20260615-****
 * Legacy format (GEX-YYYYMMDD-XX): GEX-20260219-A3F9C21B → GEX-20260219-****C21B
 */
export function maskTrackingNumber(trackingNumber: string): string {
  // New customer-facing format: YYYYMMDD-NNNN
  const newFormat = /^(\d{8}-)(\d{4})$/.exec(trackingNumber)
  if (newFormat) {
    return `${newFormat[1]}****`
  }

  // Legacy format: GEX-YYYYMMDD-XXXXXXXX
  const legacyFormat = /^([A-Z]+-\d{8}-)([A-Z0-9]{8})$/.exec(trackingNumber)
  if (legacyFormat) {
    const [, prefix, tail] = legacyFormat
    return `${prefix}****${tail.slice(-4)}`
  }

  const trimmed = trackingNumber.trim()
  if (trimmed.length <= 4) return '****'
  return `****${trimmed.slice(-4)}`
}
