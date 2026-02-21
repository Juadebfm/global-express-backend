import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Populated by the authenticate middleware after token verification.
     * Works for both Clerk-authenticated customers and internal staff/admin/superadmin.
     */
    user: {
      id: string
      /** null for internal staff/admin/superadmin accounts (no Clerk account) */
      clerkId: string | null
      role: string
      email: string
    }
    /**
     * Raw request body as string — populated only on webhook routes
     * for signature verification (Paystack HMAC-SHA512, Clerk svix).
     */
    rawBody?: string
  }
}
