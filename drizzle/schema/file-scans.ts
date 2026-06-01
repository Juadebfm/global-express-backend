import { pgTable, uuid, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core'

/**
 * AV scan tracking for every user-uploaded file (ASVS V12.4.1).
 *
 * Workflow:
 *   1. Upload confirm endpoint inserts a row with status='pending'.
 *   2. AV scan service downloads the object from R2, hashes it (SHA-256),
 *      and queries VirusTotal.
 *   3. Status moves to 'clean' | 'malicious' | 'error' | 'skipped'.
 *   4. Staff UI must check status='clean' before displaying / opening.
 */
export const fileScans = pgTable(
  'file_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    r2Key: text('r2_key').notNull().unique(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id'),
    status: text('status').notNull().default('pending'),
    sha256: text('sha256'),
    bytes: integer('bytes'),
    scanProvider: text('scan_provider'),
    scanResponse: jsonb('scan_response'),
    scannedAt: timestamp('scanned_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('file_scans_status_idx').on(table.status),
    index('file_scans_scope_idx').on(table.scope, table.scopeId),
    index('file_scans_created_at_idx').on(table.createdAt),
  ],
)

export type FileScanStatus = 'pending' | 'clean' | 'malicious' | 'error' | 'skipped'
