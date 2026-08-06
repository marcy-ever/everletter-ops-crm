import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const crmState = pgTable(
  "crm_state",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    itemKey: text("item_key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    kindItemKeyIdx: uniqueIndex("crm_state_kind_item_key_idx").on(table.kind, table.itemKey),
  }),
);
