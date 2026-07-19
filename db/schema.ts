import { sql } from "drizzle-orm";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const crmState = sqliteTable(
  "crm_state",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    itemKey: text("item_key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    kindItemKeyIdx: uniqueIndex("crm_state_kind_item_key_idx").on(table.kind, table.itemKey),
  }),
);
