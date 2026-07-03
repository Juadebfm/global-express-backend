import { pgEnum, pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { galleryItems } from './gallery'

export const inboundLeadTypeEnum = pgEnum('inbound_lead_type', ['d2d_intake', 'shop_inquiry'])

export const inboundLeadStatusEnum = pgEnum('inbound_lead_status', [
  'new',
  'contacted',
  'converted',
  'closed',
])

export const inboundLeads = pgTable(
  'inbound_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadType: inboundLeadTypeEnum('lead_type').notNull(),
    status: inboundLeadStatusEnum('status').notNull().default('new'),

    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    originCountry: text('origin_country'),
    message: text('message'),

    itemId: uuid('item_id').references(() => galleryItems.id, { onDelete: 'set null' }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    convertedAt: timestamp('converted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('inbound_leads_lead_type_idx').on(table.leadType),
    index('inbound_leads_status_idx').on(table.status),
    index('inbound_leads_item_id_idx').on(table.itemId),
    index('inbound_leads_assigned_to_idx').on(table.assignedTo),
    index('inbound_leads_created_at_idx').on(table.createdAt),
  ],
)
