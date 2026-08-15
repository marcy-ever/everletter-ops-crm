import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// One row per change made through POST /api/shared-state's three
// per-item kinds (mailingStatus/componentStatus/reviewedException) plus one
// per crmDataset import - the per-change complement to ingestion_events
// (db/schema/ingestion_events.ts), which already covers imports on their
// own but at a completely different cardinality (a handful of imports vs.
// thousands of status flips) and payload shape (a full dataset vs. one
// field). See app/api/shared-state/route.ts for where these rows get
// written and docs/data-recovery.md for the measured row size/retention
// treatment (mirroring ingestion_events's own).
//
// kind/itemKey deliberately reuse the exact vocabulary the route already
// has: kind is "mailingStatus"/"componentStatus"/"reviewedException"/
// "crmDataset", itemKey is the same mailingKey/componentKey/
// exceptionReviewKey string (or "current" for an import) already used to
// address the change - no new addressing scheme invented here.
//
// previousValue is nullable (a first-ever write to a key has no prior;
// see lib/write-to-tables.ts's return-value comment for exactly how each
// write function reports it) - newValue is not, every audited event has
// one. actorEmail is nullable too, but for a different reason: see
// app/api/shared-state/route.ts's POST handler for what "no session"
// actually means here and why it's recorded rather than assumed
// impossible.
//
// occurredAt is indexed descending because the one read endpoint this
// table has (GET /api/audit) always wants newest-first - see that route.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
    actorEmail: text("actor_email"),
    kind: text("kind").notNull(),
    itemKey: text("item_key").notNull(),
    previousValue: text("previous_value"),
    newValue: text("new_value").notNull(),
  },
  (table) => [index("audit_events_occurred_at_idx").on(table.occurredAt.desc())],
);
