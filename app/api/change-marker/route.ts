import { getDb } from "@/db";
import { currentChangeMarker } from "@/lib/change-marker";

// The dedicated poll target for "someone else changed something, refresh"
// staleness detection (lib/client/staleness.ts). Deliberately separate from
// GET /api/audit (Marcy's paged read side, which reconstructs and returns
// actual event rows) and from GET /api/shared-state (which reconstructs
// the entire dataset) - a poll that fires every 30-60s needs to cost as
// close to nothing as possible, and this is one indexed MAX(id) aggregate,
// nothing else. See lib/change-marker.ts for the query itself and why it's
// cheap.
//
// Authenticated the ordinary way - inside proxy.ts's default matcher, not
// exempted, same as every other route here except api/health and api/auth.
export async function GET() {
  try {
    const marker = await currentChangeMarker(getDb());
    return Response.json({ marker });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not load the change marker." }, { status: 500 });
  }
}
