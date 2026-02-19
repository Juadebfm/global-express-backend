import { describe, it, expect } from 'vitest'
import {
  parsePaginationQuery,
  getPaginationOffset,
  buildPaginatedResult,
} from '../../src/utils/pagination'

describe('parsePaginationQuery', () => {
  it('returns defaults when no query params provided', () => {
    const result = parsePaginationQuery({})
    expect(result).toEqual({ page: 1, limit: 20 })
  })

  it('clamps limit to max 100', () => {
    const result = parsePaginationQuery({ page: 1, limit: 9999 })
    expect(result.limit).toBe(100)
  })

  it('clamps page to minimum 1', () => {
    const result = parsePaginationQuery({ page: -5, limit: 10 })
    expect(result.page).toBe(1)
  })

  it('parses valid numeric strings', () => {
    const result = parsePaginationQuery({ page: '3', limit: '50' })
    expect(result).toEqual({ page: 3, limit: 50 })
  })
})

describe('getPaginationOffset', () => {
  it('returns 0 for page 1', () => {
    expect(getPaginationOffset(1, 20)).toBe(0)
  })

  it('returns correct offset for page 3', () => {
    expect(getPaginationOffset(3, 20)).toBe(40)
  })
})

describe('buildPaginatedResult', () => {
  it('calculates totalPages correctly', () => {
    const result = buildPaginatedResult(['a', 'b'], 45, { page: 2, limit: 20 })
    expect(result.pagination.totalPages).toBe(3)
    expect(result.pagination.total).toBe(45)
    expect(result.data).toHaveLength(2)
  })
})
