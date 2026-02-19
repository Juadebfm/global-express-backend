export function successResponse<T>(data: T) {
  return { success: true as const, data }
}

export function errorResponse(message: string, errors?: unknown[]) {
  return {
    success: false as const,
    message,
    ...(errors !== undefined ? { errors } : {}),
  }
}
