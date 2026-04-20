import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { invoices } from './invoices'
import { orders } from './orders'
import { users } from './users'

export const invoiceAttachmentTypeEnum = pgEnum('invoice_attachment_type', [
  'TASK_INVOICE',
  'REGULATED_DOCUMENT',
])

export const invoiceAttachments = pgTable(
  'invoice_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    attachmentType: invoiceAttachmentTypeEnum('attachment_type').notNull().default('TASK_INVOICE'),
    originalFileName: text('original_file_name').notNull(),
    contentType: text('content_type').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    r2Key: text('r2_key').notNull().unique(),
    r2Url: text('r2_url').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('invoice_attachments_invoice_id_idx').on(table.invoiceId),
    index('invoice_attachments_order_id_idx').on(table.orderId),
    index('invoice_attachments_attachment_type_idx').on(table.attachmentType),
    index('invoice_attachments_uploaded_by_idx').on(table.uploadedBy),
    index('invoice_attachments_created_at_idx').on(table.createdAt),
  ],
)

