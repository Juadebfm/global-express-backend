import type { PaginationParams, PaginatedResult } from '../types'

export function parsePaginationQuery(query: {
  page?: unknown
  limit?: unknown
}): PaginationParams {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  return { page, limit }
}

export function getPaginationOffset(page: number, limit: number): number {
  return (page - 1) * limit
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> {
  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  }
}

/**
 * Parses the `?sort=` query parameter using the Stripe/GitHub convention:
 *
 *   ?sort=createdAt          → [{ field: 'createdAt', direction: 'asc' }]
 *   ?sort=-createdAt         → [{ field: 'createdAt', direction: 'desc' }]
 *   ?sort=-status,createdAt  → multi-field, ordered
 *
 * Pass `allowedFields` (Set of allowed sort keys) so callers can reject
 * arbitrary user input — otherwise an attacker can sort by an indexed PII column.
 * Unknown fields are silently dropped.
 *
 * If no `sort` param or no valid fields, returns the supplied default.
 */
export type SortDirection = 'asc' | 'desc'
export interface SortField {
  field: string
  direction: SortDirection
}

export function parseSortQuery(
  query: { sort?: unknown },
  allowedFields: ReadonlyArray<string>,
  defaultSort: ReadonlyArray<SortField> = [],
): SortField[] {
  const raw = typeof query.sort === 'string' ? query.sort.trim() : ''
  if (!raw) return [...defaultSort]

  const allowed = new Set(allowedFields)
  const parsed: SortField[] = []

  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    let field = entry
    let direction: SortDirection = 'asc'
    if (entry.startsWith('-')) {
      direction = 'desc'
      field = entry.slice(1)
    } else if (entry.startsWith('+')) {
      field = entry.slice(1)
    }
    if (!allowed.has(field)) continue
    parsed.push({ field, direction })
  }

  return parsed.length > 0 ? parsed : [...defaultSort]
}
