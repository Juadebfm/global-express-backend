import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core'
import { orders, shipmentStatusV2Enum } from './orders'
import { users } from './users'

export const orderStatusEvents = pgTable(
  'order_status_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: shipmentStatusV2Enum('status').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('order_status_events_order_id_idx').on(table.orderId),
    index('order_status_events_actor_id_idx').on(table.actorId),
    index('order_status_events_created_at_idx').on(table.createdAt),
  ],
)
