import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './users'

export const userSuppliers = pgTable(
  'user_suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    linkedByUserId: uuid('linked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_suppliers_user_supplier_unique').on(table.userId, table.supplierId),
    index('user_suppliers_user_id_idx').on(table.userId),
    index('user_suppliers_supplier_id_idx').on(table.supplierId),
    index('user_suppliers_linked_by_user_id_idx').on(table.linkedByUserId),
    index('user_suppliers_created_at_idx').on(table.createdAt),
  ],
)
