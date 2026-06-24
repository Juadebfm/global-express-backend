import { pgEnum, pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core'
import { users } from './users'
import { dispatchBatches } from './dispatch-batches'

export const batchDocumentTypeEnum = pgEnum('batch_document_type', [
  'mawb',
  'bill_of_lading',
  'container_photo',
  'vessel_photo',
  'other',
])

export const batchDocuments = pgTable(
  'batch_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => dispatchBatches.id),
    documentType: batchDocumentTypeEnum('document_type').notNull(),
    fileUrl: text('file_url').notNull(),
    fileName: text('file_name'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('batch_documents_batch_id_idx').on(table.batchId),
    index('batch_documents_type_idx').on(table.documentType),
  ],
)
