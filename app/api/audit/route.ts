import { desc, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents } from "@/db/schema/audit_events";

// Read side of the audit log app/api/shared-state/route.ts's POST handler
// writes (db/schema/audit_events.ts). Authenticated the ordinary way -
// this route is inside proxy.ts's default matcher, not one of its explicit
// exemptions (unlike api/health), so it needs no code here to require a
// session; proxy.ts already redirects an unauthenticated request before it
// ever reaches this handler.
//
// This is deliberately the whole scope: newest-first, a bounded page, and
// nothing else. What the data looks like and how it's filtered is Marcy's
// own screen to build - see CLAUDE.md's Decided Direction section on where
// that line sits for this task. No UI here.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const limitParam = url.searchParams.get("limit");
    let limit = DEFAULT_LIMIT;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return Response.json({ error: "limit must be a positive number." }, { status: 400 });
      }
      limit = Math.min(Math.trunc(parsed), MAX_LIMIT);
    }

    // Cursor-based paging: "give me the page older than the last row I
    // already have," addressed by that row's id. id (an auto-incrementing
    // serial) and occurred_at (server now() at insert time) always agree
    // on ordering - both are assigned in strictly increasing insert order -
    // so filtering by id here is equivalent to filtering by occurred_at,
    // simpler, and exact (no timestamp-precision tie-breaking needed).
    const beforeParam = url.searchParams.get("before");
    let beforeId: number | null = null;
    if (beforeParam !== null) {
      const parsed = Number(beforeParam);
      if (!Number.isFinite(parsed)) {
        return Response.json({ error: "before must be a valid audit_events id." }, { status: 400 });
      }
      beforeId = Math.trunc(parsed);
    }

    const db = getDb();
    const events = await db
      .select()
      .from(auditEvents)
      .where(beforeId !== null ? lt(auditEvents.id, beforeId) : undefined)
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);

    return Response.json({ events, limit });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not load audit events." }, { status: 500 });
  }
}
