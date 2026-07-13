import { sql } from 'drizzle-orm'
import { trackingNumberCounters } from '../../drizzle/schema'

type TrackingNumberExecutor = {
  insert: (...args: any[]) => any
}

function formatDateKey(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function formatCustomerTrackingNumber(dateKey: string, sequence: number): string {
  return `${dateKey}-${String(sequence).padStart(4, '0')}`
}

/**
 * Generates the standard customer-facing tracking number used across
 * orders, gallery items, and other public-facing shipment references.
 * Format: YYYYMMDD-NNNN
 */
export async function generateTrackingNumber(
  executor?: TrackingNumberExecutor,
  createdAt: Date = new Date(),
): Promise<string> {
  const dateKey = formatDateKey(createdAt)
  const dbExecutor = executor ?? (await import('../config/db')).db
  const [counter] = await dbExecutor
    .insert(trackingNumberCounters)
    .values({
      trackingDateKey: dateKey,
      lastValue: 1,
    })
    .onConflictDoUpdate({
      target: trackingNumberCounters.trackingDateKey,
      set: {
        lastValue: sql`${trackingNumberCounters.lastValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastValue: trackingNumberCounters.lastValue })

  if (!counter) {
    throw new Error('Failed to reserve tracking number.')
  }

  if (counter.lastValue > 9999) {
    throw new Error(`Daily tracking sequence exhausted for ${dateKey}.`)
  }

  return formatCustomerTrackingNumber(dateKey, counter.lastValue)
}

/**
 * Generates the customer-facing tracking number for a batch slot.
 * Format: YYYYMMDD-NNNN (e.g. 20260615-0020)
 * Date is the batch creation date; position is the customer's sequential slot number in this batch.
 */
export function generateSlotTrackingNumber(batchCreatedAt: Date, position: number): string {
  return formatCustomerTrackingNumber(formatDateKey(batchCreatedAt), position)
}

/**
 * Generates the internal batch master tracking number.
 * Format: AIR-YYYYMMDD-NNNN or SEA-YYYYMMDD-NNNN
 * Date is the batch creation date; yearSequence is how many batches of this mode exist this calendar year (including this one).
 */
export function generateMasterTrackingNumber(mode: 'air' | 'sea', batchCreatedAt: Date, yearSequence: number): string {
  const prefix = mode.toUpperCase()
  const date = formatDateKey(batchCreatedAt)
  const seq = String(yearSequence).padStart(4, '0')
  return `${prefix}-${date}-${seq}`
}

export function isCustomerTrackingNumber(trackingNumber: string): boolean {
  return /^\d{8}-\d{4}$/.test(trackingNumber.trim())
}

export function isMasterTrackingNumber(trackingNumber: string): boolean {
  return /^(AIR|SEA)-\d{8}-\d{4}$/.test(trackingNumber.trim().toUpperCase())
}

/**
 * Masks a tracking number for public display.
 * New format (YYYYMMDD-NNNN):   20260615-0020 → 20260615-****
 * Legacy format (GEX-YYYYMMDD-XX): GEX-20260219-A3F9C21B → GEX-20260219-****C21B
 */
export function maskTrackingNumber(trackingNumber: string): string {
  // New customer-facing format: YYYYMMDD-NNNN
  const newFormat = /^(\d{8}-)(\d{4})$/.exec(trackingNumber.trim())
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
