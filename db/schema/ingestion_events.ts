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
  // The complete posted dataset - what makes a row restorable via
  // devops/restore-ingestion-event.mjs (docs/data-recovery.md). Unbounded
  // growth, flagged not solved: ~779 KiB/row measured against the real
  // 1,218-row test fixture as of 2026-08-15, ~292 MB/year at one import/day
  // and only growing as the real dataset does. See docs/data-recovery.md's
  // retention section for the recommendation (not yet implemented) - update
  // this comment when a real policy lands.
  rawPayload: jsonb("raw_payload"),
  status: text("status").notNull(),
  summary: text("summary"),
});
