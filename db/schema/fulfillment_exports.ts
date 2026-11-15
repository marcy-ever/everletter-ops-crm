import { date, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const fulfillmentExports = pgTable(
  "fulfillment_exports",
  {
    id: serial("id").primaryKey(),
    batchDate: date("batch_date", { mode: "string" }).notNull(),
    batchName: text("batch_name").notNull(),
    exportKind: text("export_kind").notNull(),
    designGroup: text("design_group").notNull(),
    rowCount: integer("row_count").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    exportedBy: text("exported_by"),
    exportedAt: timestamp("exported_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("fulfillment_exports_batch_date_idx").on(table.batchDate), index("fulfillment_exports_batch_name_idx").on(table.batchName)],
);
