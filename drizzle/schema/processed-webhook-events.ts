import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'

/**
 * Processed-webhook-event log — used to dedup duplicate webhook deliveries
 * from external providers. Insert before processing; if the insert fails
 * (unique-violation) the event has already been handled and should be skipped.
 *
 * Key examples:
 *   - provider='clerk', event_id=<svix-id>
 *   - provider='paystack', event_id=<paystack data.id>
 */
export const processedWebhookEvents = pgTable(
  'processed_webhook_events',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    processedAt: timestamp('processed_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.eventId] })],
)
