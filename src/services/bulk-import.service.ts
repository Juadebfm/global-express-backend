import * as XLSX from 'xlsx'
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

function inferRoleFromSheetName(sheetName: string): ImportRole | undefined {
  const normalized = sheetName.trim().toLowerCase()
  if (normalized.includes('supplier') || normalized.includes('vendor')) return UserRole.SUPPLIER
  if (normalized.includes('user') || normalized.includes('client') || normalized.includes('customer')) {
    return UserRole.USER
  }
  return undefined
}

function pickField(
  row: Record<string, unknown>,
  normalizedMap: Map<string, string>,
  aliases: string[],
): unknown {
  for (const alias of aliases) {
    const key = normalizedMap.get(alias)
    if (!key) continue
    return row[key]
  }
  return undefined
}

function parseRowsFromWorkbook(buffer: Buffer): ParsedImportRow[] {
  let workbook: XLSX.WorkBook

  try {
    workbook = XLSX.read(buffer, { type: 'buffer' })
  } catch {
    throw httpError('Unable to parse file. Upload a valid CSV or Excel (.xlsx) sheet.', 400)
  }

  const parsed: ParsedImportRow[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const roleFromSheet = inferRoleFromSheetName(sheetName)
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
    })

    rows.forEach((row, index) => {
      const normalizedMap = new Map<string, string>()
      for (const key of Object.keys(row)) {
        normalizedMap.set(normalizeHeader(key), key)
      }

      const parsedRole =
        parseRole(
          pickField(row, normalizedMap, ['role', 'type', 'entity', 'entitytype', 'accounttype']),
        ) ?? roleFromSheet

      parsed.push({
        rowNumber: index + 2,
        role: parsedRole,
        email: toStringValue(pickField(row, normalizedMap, ['email', 'emailaddress'])),
        firstName: toStringValue(pickField(row, normalizedMap, ['firstname', 'fname', 'givenname'])),
        lastName: toStringValue(pickField(row, normalizedMap, ['lastname', 'lname', 'surname'])),
        businessName: toStringValue(
          pickField(row, normalizedMap, ['businessname', 'company', 'companyname', 'organization']),
        ),
        phone: toStringValue(pickField(row, normalizedMap, ['phone', 'phonenumber', 'mobile'])),
        shippingMark: toStringValue(
          pickField(row, normalizedMap, ['shippingmark', 'shippingcode', 'mark']),
        ),
        addressStreet: toStringValue(
          pickField(row, normalizedMap, ['addressstreet', 'street', 'streetaddress', 'addressline1']),
        ),
        addressCity: toStringValue(pickField(row, normalizedMap, ['addresscity', 'city'])),
        addressState: toStringValue(pickField(row, normalizedMap, ['addressstate', 'state', 'province'])),
        addressCountry: toStringValue(pickField(row, normalizedMap, ['addresscountry', 'country'])),
        addressPostalCode: toStringValue(
          pickField(row, normalizedMap, ['addresspostalcode', 'postalcode', 'zipcode', 'zip']),
        ),
        isActive: toBooleanValue(pickField(row, normalizedMap, ['isactive', 'active', 'enabled'])),
      })
    })
  }

  return parsed
}

export class BulkImportService {
  async importUsersAndSuppliers(input: {
    buffer: Buffer
    actorRole: UserRole
    dryRun: boolean
  }): Promise<BulkImportResult> {
    const rows = parseRowsFromWorkbook(input.buffer)

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
          message: 'Role not found. Provide role/type column or use sheet name users/suppliers.',
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
