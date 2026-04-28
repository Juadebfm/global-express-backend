import { eq } from 'drizzle-orm'
import { db } from '../config/db'
import { users } from '../../drizzle/schema'
import { encrypt, hashEmail } from '../utils/encryption'
import { UserRole } from '../types/enums'

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

type ImportRole = UserRole.USER | UserRole.SUPPLIER

type RowAction = 'create' | 'update' | 'skip' | 'error'

interface ParsedImportRow {
  rowNumber: number
  role?: ImportRole
  email?: string
  firstName?: string
  lastName?: string
  businessName?: string
  phone?: string
  shippingMark?: string
  addressStreet?: string
  addressCity?: string
  addressState?: string
  addressCountry?: string
  addressPostalCode?: string
  isActive?: boolean
}

interface ProcessRowResult {
  rowNumber: number
  role: string | null
  email: string | null
  action: RowAction
  message: string
}

interface ImportSummary {
  totalRows: number
  created: number
  updated: number
  skipped: number
  errors: number
}

export interface BulkImportResult {
  dryRun: boolean
  summary: ImportSummary
  results: ProcessRowResult[]
}

function normalizeHeader(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const text = String(value).trim()
  return text.length > 0 ? text : undefined
}

function toBooleanValue(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean') return value

  const text = String(value).trim().toLowerCase()
  if (!text) return undefined
  if (['true', 'yes', '1', 'active', 'enabled'].includes(text)) return true
  if (['false', 'no', '0', 'inactive', 'disabled'].includes(text)) return false
  return undefined
}

function parseRole(value: unknown): ImportRole | undefined {
  const text = toStringValue(value)?.toLowerCase()
  if (!text) return undefined

  if (['user', 'users', 'customer', 'customers', 'client', 'clients'].includes(text)) {
    return UserRole.USER
  }

  if (['supplier', 'suppliers', 'vendor', 'vendors'].includes(text)) {
    return UserRole.SUPPLIER
  }

  return undefined
}

function pickField(
  row: string[],
  normalizedMap: Map<string, number>,
  aliases: string[],
): unknown {
  for (const alias of aliases) {
    const key = normalizedMap.get(alias)
    if (key === undefined) continue
    return row[key]
  }
  return undefined
}

function parseCsvRecords(buffer: Buffer): string[][] {
  const content = buffer.toString('utf8')
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]

    // Ignore UTF-8 BOM.
    if (i === 0 && char === '\uFEFF') continue

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          currentCell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        currentCell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === ',') {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (char === '\r') {
      // CRLF: let the following '\n' finalize the row.
      if (content[i + 1] === '\n') continue
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    if (char === '\n') {
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += char
  }

  if (inQuotes) {
    throw httpError('Unable to parse CSV file. Unterminated quoted field found.', 400)
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell)
    rows.push(currentRow)
  }

  return rows
}

function parseRowsFromCsv(buffer: Buffer): ParsedImportRow[] {
  const records = parseCsvRecords(buffer)
  if (records.length === 0) return []

  const [headerRow, ...dataRows] = records
  const normalizedMap = new Map<string, number>()
  headerRow.forEach((header, index) => {
    const normalized = normalizeHeader(header)
    if (!normalizedMap.has(normalized)) {
      normalizedMap.set(normalized, index)
    }
  })

  const parsed: ParsedImportRow[] = []

  dataRows.forEach((row, index) => {
    const normalizedRow = headerRow.map((_, columnIndex) => row[columnIndex] ?? '')
    const hasValues = normalizedRow.some((value) => value.trim().length > 0)
    if (!hasValues) return

    const parsedRole = parseRole(
      pickField(normalizedRow, normalizedMap, ['role', 'type', 'entity', 'entitytype', 'accounttype']),
    )

    parsed.push({
      rowNumber: index + 2,
      role: parsedRole,
      email: toStringValue(pickField(normalizedRow, normalizedMap, ['email', 'emailaddress'])),
      firstName: toStringValue(pickField(normalizedRow, normalizedMap, ['firstname', 'fname', 'givenname'])),
      lastName: toStringValue(pickField(normalizedRow, normalizedMap, ['lastname', 'lname', 'surname'])),
      businessName: toStringValue(
        pickField(normalizedRow, normalizedMap, ['businessname', 'company', 'companyname', 'organization']),
      ),
      phone: toStringValue(pickField(normalizedRow, normalizedMap, ['phone', 'phonenumber', 'mobile'])),
      shippingMark: toStringValue(
        pickField(normalizedRow, normalizedMap, ['shippingmark', 'shippingcode', 'mark']),
      ),
      addressStreet: toStringValue(
        pickField(normalizedRow, normalizedMap, ['addressstreet', 'street', 'streetaddress', 'addressline1']),
      ),
      addressCity: toStringValue(pickField(normalizedRow, normalizedMap, ['addresscity', 'city'])),
      addressState: toStringValue(pickField(normalizedRow, normalizedMap, ['addressstate', 'state', 'province'])),
      addressCountry: toStringValue(pickField(normalizedRow, normalizedMap, ['addresscountry', 'country'])),
      addressPostalCode: toStringValue(
        pickField(normalizedRow, normalizedMap, ['addresspostalcode', 'postalcode', 'zipcode', 'zip']),
      ),
      isActive: toBooleanValue(pickField(normalizedRow, normalizedMap, ['isactive', 'active', 'enabled'])),
    })
  })

  return parsed
}

export class BulkImportService {
  async importUsersAndSuppliers(input: {
    buffer: Buffer
    actorRole: UserRole
    dryRun: boolean
  }): Promise<BulkImportResult> {
    const rows = parseRowsFromCsv(input.buffer)

    if (rows.length === 0) {
      throw httpError('No data rows found in file.', 400)
    }

    const results: ProcessRowResult[] = []
    const summary: ImportSummary = {
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    }

    const seenEmails = new Set<string>()

    for (const row of rows) {
      const role = row.role
      const email = row.email?.toLowerCase()

      if (!role) {
        results.push({
          rowNumber: row.rowNumber,
          role: null,
          email: email ?? null,
          action: 'error',
          message: 'Role not found. Provide role/type column values like user or supplier.',
        })
        summary.errors += 1
        continue
      }

      if (!email) {
        results.push({
          rowNumber: row.rowNumber,
          role,
          email: null,
          action: 'error',
          message: 'Email is required.',
        })
        summary.errors += 1
        continue
      }

      if (seenEmails.has(email)) {
        results.push({
          rowNumber: row.rowNumber,
          role,
          email,
          action: 'error',
          message: 'Duplicate email in uploaded file.',
        })
        summary.errors += 1
        continue
      }
      seenEmails.add(email)

      const emailHash = hashEmail(email)

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.emailHash, emailHash))
        .limit(1)

      if (existing && [UserRole.STAFF, UserRole.SUPER_ADMIN].includes(existing.role as UserRole)) {
        results.push({
          rowNumber: row.rowNumber,
          role,
          email,
          action: 'error',
          message: 'Email belongs to an internal account and cannot be imported here.',
        })
        summary.errors += 1
        continue
      }

      if (existing && existing.role !== role) {
        results.push({
          rowNumber: row.rowNumber,
          role,
          email,
          action: 'error',
          message: `Role mismatch. Existing account role is ${existing.role}.`,
        })
        summary.errors += 1
        continue
      }

      let shippingMarkIgnored = false
      if (row.shippingMark && input.actorRole !== UserRole.SUPER_ADMIN) {
        shippingMarkIgnored = true
      }

      const createValues: typeof users.$inferInsert = {
        clerkId: null,
        role,
        email: encrypt(email),
        emailHash,
        firstName: row.firstName ? encrypt(row.firstName) : null,
        lastName: row.lastName ? encrypt(row.lastName) : null,
        businessName: row.businessName ? encrypt(row.businessName) : null,
        phone: row.phone ? encrypt(row.phone) : null,
        shippingMark:
          row.shippingMark && input.actorRole === UserRole.SUPER_ADMIN
            ? encrypt(row.shippingMark)
            : null,
        addressStreet: row.addressStreet ? encrypt(row.addressStreet) : null,
        addressCity: row.addressCity ?? null,
        addressState: row.addressState ?? null,
        addressCountry: row.addressCountry ?? null,
        addressPostalCode: row.addressPostalCode ?? null,
        isActive: row.isActive ?? true,
      }

      const updatePatch: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
        deletedAt: null,
        isActive: row.isActive ?? existing?.isActive ?? true,
        firstName: row.firstName ? encrypt(row.firstName) : existing?.firstName ?? null,
        lastName: row.lastName ? encrypt(row.lastName) : existing?.lastName ?? null,
        businessName: row.businessName ? encrypt(row.businessName) : existing?.businessName ?? null,
        phone: row.phone ? encrypt(row.phone) : existing?.phone ?? null,
        addressStreet: row.addressStreet
          ? encrypt(row.addressStreet)
          : existing?.addressStreet ?? null,
        addressCity: row.addressCity ?? existing?.addressCity ?? null,
        addressState: row.addressState ?? existing?.addressState ?? null,
        addressCountry: row.addressCountry ?? existing?.addressCountry ?? null,
        addressPostalCode: row.addressPostalCode ?? existing?.addressPostalCode ?? null,
      }

      if (row.shippingMark && input.actorRole === UserRole.SUPER_ADMIN) {
        updatePatch.shippingMark = encrypt(row.shippingMark)
      }

      if (input.dryRun) {
        if (existing) {
          results.push({
            rowNumber: row.rowNumber,
            role,
            email,
            action: 'update',
            message: shippingMarkIgnored
              ? 'Would update existing account (shippingMark ignored for non-superadmin).'
              : 'Would update existing account.',
          })
          summary.updated += 1
        } else {
          results.push({
            rowNumber: row.rowNumber,
            role,
            email,
            action: 'create',
            message: shippingMarkIgnored
              ? 'Would create account (shippingMark ignored for non-superadmin).'
              : 'Would create account.',
          })
          summary.created += 1
        }
        continue
      }

      if (existing) {
        await db
          .update(users)
          .set(updatePatch)
          .where(eq(users.id, existing.id))

        results.push({
          rowNumber: row.rowNumber,
          role,
          email,
          action: 'update',
          message: shippingMarkIgnored
            ? 'Updated existing account (shippingMark ignored for non-superadmin).'
            : 'Updated existing account.',
        })
        summary.updated += 1
      } else {
        await db.insert(users).values(createValues)

        results.push({
          rowNumber: row.rowNumber,
          role,
          email,
          action: 'create',
          message: shippingMarkIgnored
            ? 'Created account (shippingMark ignored for non-superadmin).'
            : 'Created account.',
        })
        summary.created += 1
      }
    }

    summary.skipped = summary.totalRows - summary.created - summary.updated - summary.errors

    return {
      dryRun: input.dryRun,
      summary,
      results,
    }
  }
}

export const bulkImportService = new BulkImportService()
