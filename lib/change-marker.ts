import { sql } from "drizzle-orm";
import { auditEvents } from "@/db/schema/audit_events";
import type { Db } from "@/lib/write-to-tables";

/**
 * The entire mechanism behind "someone else changed something, refresh"
 * staleness detection (CLAUDE.md §8's long-standing top item): a single
 * MAX(id) aggregate against audit_events (db/schema/audit_events.ts).
 * audit_events already carries one monotonically increasing id per real
 * change - and, load-bearingly, per real change *only*: a soft-skipped
 * write (a key matching no row) produces no audit_events row at all (see
 * that table's own module comment), so this marker can never advance on a
 * no-op. `id` is the table's serial primary key, so MAX(id) is answered
 * from the primary key's own btree index without touching a single row of
 * actual data - verified directly via EXPLAIN, not assumed (see
 * tests/audit-events.e2e.test.mjs).
 *
 * Returns null only when audit_events is empty (nothing has ever been
 * written) - a real, valid "no changes yet" state, not an error.
 *
 * Shared by three call sites that all need the same query: the dedicated
 * GET /api/change-marker (app/api/change-marker/route.ts, the cheap poll
 * target), and GET/POST /api/shared-state (app/api/shared-state/route.ts),
 * which each return this alongside their own response so a client's
 * baseline/staleness comparison always has a marker consistent with what
 * it just received - never a separate round trip that could race.
 */
export async function currentChangeMarker(db: Db): Promise<number | null> {
  const [row] = await db.select({ marker: sql<number | null>`max(${auditEvents.id})` }).from(auditEvents);
  return row?.marker ?? null;
}
