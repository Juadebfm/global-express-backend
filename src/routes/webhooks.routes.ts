import type { FastifyInstance } from 'fastify'
import { Webhook } from 'svix'
import { env } from '../config/env'
import { usersService } from '../services/users.service'

interface ClerkEmailAddress {
  id: string
  email_address: string
}

interface ClerkPhoneNumber {
  id: string
  phone_number: string
}

interface ClerkUserUpdatedData {
  id: string
  email_addresses: ClerkEmailAddress[]
  first_name: string | null
  last_name: string | null
  phone_numbers: ClerkPhoneNumber[]
  primary_email_address_id: string | null
  primary_phone_number_id: string | null
}

interface ClerkUserDeletedData {
  id: string
  deleted: boolean
}

interface ClerkWebhookEvent {
  type: string
  data: ClerkUserUpdatedData | ClerkUserDeletedData
}

export async function webhooksRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /webhooks/clerk
   * Receives user lifecycle events from Clerk and syncs the local database.
   *
   * Events handled:
   *   user.updated  — updates email, name, and phone in the database
   *   user.deleted  — soft-deletes the user in the database
   *
   * Setup:
   *   1. Go to Clerk Dashboard → Webhooks → Add Endpoint
   *   2. URL: https://your-domain.com/webhooks/clerk
   *   3. Subscribe to: user.updated, user.deleted
   *   4. Copy the Signing Secret into CLERK_WEBHOOK_SECRET in your .env
   */
  fastify.post('/clerk', {
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } }, // higher limit for webhook
    schema: {
      tags: ['Webhooks'],
      summary: 'Clerk user lifecycle webhook',
      description:
        'Receives `user.updated` and `user.deleted` events from Clerk to keep the local database in sync. Requires CLERK_WEBHOOK_SECRET to be configured.',
    },
    handler: async (request, reply) => {
      // Fail fast if the secret isn't configured — prevents silent misconfiguration
      if (!env.CLERK_WEBHOOK_SECRET) {
        fastify.log.warn('CLERK_WEBHOOK_SECRET is not set — Clerk webhook endpoint is disabled')
        return reply.code(503).send({ success: false, message: 'Webhook not configured' })
      }

      // svix headers are always present on genuine Clerk deliveries
      const svixId = request.headers['svix-id'] as string | undefined
      const svixTimestamp = request.headers['svix-timestamp'] as string | undefined
      const svixSignature = request.headers['svix-signature'] as string | undefined

      if (!svixId || !svixTimestamp || !svixSignature) {
        return reply.code(400).send({ success: false, message: 'Missing svix headers' })
      }

      if (!request.rawBody) {
        return reply.code(400).send({ success: false, message: 'No raw body available' })
      }

      // Verify the webhook signature using svix
      let event: ClerkWebhookEvent
      try {
        const wh = new Webhook(env.CLERK_WEBHOOK_SECRET)
        event = wh.verify(request.rawBody, {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        }) as ClerkWebhookEvent
      } catch (err) {
        fastify.log.warn({ err }, 'Clerk webhook signature verification failed')
        return reply.code(400).send({ success: false, message: 'Invalid webhook signature' })
      }

      // ─── user.updated ──────────────────────────────────────────────────────
      if (event.type === 'user.updated') {
        const data = event.data as ClerkUserUpdatedData

        const primaryEmail = data.email_addresses.find(
          (e) => e.id === data.primary_email_address_id,
        )?.email_address

        const primaryPhone =
          data.phone_numbers.find((p) => p.id === data.primary_phone_number_id)?.phone_number ??
          null

        await usersService.syncFromClerk(data.id, {
          email: primaryEmail,
          firstName: data.first_name ?? undefined,
          lastName: data.last_name ?? undefined,
          phone: primaryPhone,
        })

        fastify.log.info({ clerkId: data.id }, 'Synced updated user from Clerk')
      }

      // ─── user.deleted ──────────────────────────────────────────────────────
      if (event.type === 'user.deleted') {
        const data = event.data as ClerkUserDeletedData
        const user = await usersService.getUserByClerkId(data.id)
        if (user) {
          await usersService.softDeleteUser(user.id)
          fastify.log.info({ clerkId: data.id }, 'Soft-deleted user from Clerk deletion event')
        }
      }

      // Always acknowledge to Clerk — unhandled event types are silently ignored
      return reply.send({ received: true })
    },
  })
}
