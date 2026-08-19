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
  // Structured skip data from this import's own writeImport() call
  // (lib/write-to-tables.ts's ImportSummary.skipped) - null for rows
  // written before this column existed, and for non-import event kinds
  // this table might carry in the future. Deliberately a separate column
  // from `summary` above, not folded into it: `summary` is a fixed-shape,
  // human-readable one-liner used elsewhere as-is (audit_events.new_value,
  // this file's own restore-listing output) - growing it to also carry a
  // variable-length, nested skip breakdown would turn a simple string into
  // something that has to be parsed to be useful, and would make every
  // existing reader of `summary` need to know to ignore the new part. A
  // second jsonb column keeps `summary` exactly what it already is and
  // gives the skip data the same shape treatment `raw_payload` already
  // gets - structured, queryable, and only ever read by something that
  // knows to look for it (the POST /api/shared-state response and the
  // Import Sheet view's reconciliation panel). Same unbounded-growth
  // caveat as `raw_payload` applies here too, just smaller per row (a
  // handful of reasons/row-numbers, not a full dataset) - not yet folded
  // into docs/data-recovery.md's retention section, worth doing whenever
  // that's revisited.
  skipped: jsonb("skipped"),
});
