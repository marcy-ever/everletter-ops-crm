import { sql } from "drizzle-orm";
import { getDb } from "@/db";

// Deploy-time liveness check, not a status page - see
// devops/docker-compose.app.yml's `app` service healthcheck and
// devops/deploy.sh, which polls this indirectly via Docker's health
// state until it reports healthy (or times out and fails the deploy).
// `up -d` returning zero only means Docker accepted the container, not
// that Next booted or can reach Postgres - this is the actual proof.
//
// Unauthenticated by necessity (proxy.ts exempts it explicitly, not via
// the extension-based static-asset rule) - a container healthcheck can't
// hold a session cookie. Treat everything this returns as public:
// `SELECT 1` is the cheapest possible real round-trip to Postgres (no
// schema/row access), and the response body stays deliberately minimal -
// no error detail, no connection string, no stack trace, nothing an
// unauthenticated caller shouldn't see. Not the place for a version
// stamp or diagnostics either, even though it looks like a natural home
// for one later - that's a separate, queued decision.
export async function GET() {
  try {
    await getDb().execute(sql`SELECT 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
