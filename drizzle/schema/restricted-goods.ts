import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const restrictedGoods = pgTable(
  'restricted_goods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameKo: text('name_ko'),
    description: text('description'),
    allowWithOverride: boolean('allow_with_override').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('restricted_goods_code_unique_idx').on(table.code),
    index('restricted_goods_is_active_idx').on(table.isActive),
  ],
)
