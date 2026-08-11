import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Generic audit trail for how data entered the system - deliberately not
// spreadsheet-specific. Today the only ingestion path is manual spreadsheet
// upload; a future Squarespace sync would be a second source feeding the
// same normalized tables, covered by this same table rather than a separate
// mechanism built later. See docs/schema-design.md.
export const ingestionEvents = pgTable("ingestion_events", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
  rawPayload: jsonb("raw_payload"),
  status: text("status").notNull(),
  summary: text("summary"),
});
