import { pgTable, uuid, text, timestamp, index, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const dispatchBatchStatusEnum = pgEnum('dispatch_batch_status', [
  'open',
  'cutoff_pending_approval',
  'closed',
])

export const dispatchBatches = pgTable(
  'dispatch_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    masterTrackingNumber: text('master_tracking_number').notNull().unique(),
    transportMode: text('transport_mode').notNull(), // air | sea
    status: dispatchBatchStatusEnum('status').notNull().default('open'),
    cutoffRequestedBy: uuid('cutoff_requested_by').references(() => users.id),
    cutoffRequestedAt: timestamp('cutoff_requested_at'),
    cutoffApprovedBy: uuid('cutoff_approved_by').references(() => users.id),
    cutoffApprovedAt: timestamp('cutoff_approved_at'),
    closedAt: timestamp('closed_at'),
    carrierName: text('carrier_name'),
    airlineTrackingNumber: text('airline_tracking_number'),
    oceanTrackingNumber: text('ocean_tracking_number'),
    d2dTrackingNumber: text('d2d_tracking_number'),
    voyageOrFlightNumber: text('voyage_or_flight_number'),
    estimatedDepartureAt: timestamp('estimated_departure_at'),
    estimatedArrivalAt: timestamp('estimated_arrival_at'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('dispatch_batches_master_tracking_idx').on(table.masterTrackingNumber),
    index('dispatch_batches_transport_mode_idx').on(table.transportMode),
    index('dispatch_batches_status_idx').on(table.status),
    index('dispatch_batches_created_at_idx').on(table.createdAt),
  ],
)
