import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Populated by the authenticate middleware after Clerk JWT verification.
     * All protected routes can safely access this without null checks.
     */
    user: {
      id: string
      clerkId: string
      role: string
      email: string
    }
    /**
     * Raw request body as string — populated only on webhook routes
     * for Paystack signature verification.
     */
    rawBody?: string
  }
}
