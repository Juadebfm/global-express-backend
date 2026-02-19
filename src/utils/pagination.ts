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
