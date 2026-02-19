export { UserRole, OrderStatus, PaymentStatus } from './enums'

export interface PaginationParams {
  page: number
  limit: number
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface AuthenticatedUser {
  id: string
  clerkId: string
  role: string
  email: string
}
