import { getDb } from "@/db";
import { mailings } from "@/db/schema/mailings";
import { getBuildInfo } from "@/lib/build-info";

// Deploy-time liveness check, not a status page - see
// devops/docker-compose.app.yml's `app` service healthcheck and
// devops/deploy.sh, which polls this indirectly via Docker's health
// state until it reports healthy (or times out and fails the deploy).
// `up -d` returning zero only means Docker accepted the container, not
// that Next booted or can reach Postgres - this is the actual proof.
//
// Unauthenticated by necessity (proxy.ts exempts it explicitly, not via
// the extension-based static-asset rule) - a container healthcheck can't
// hold a session cookie. Treat everything this returns as public: the
// response body stays deliberately minimal - no error detail, no
// connection string, no stack trace, no table name, nothing an
// unauthenticated caller shouldn't see. Still not the place for uptime,
// counts, or diagnostics.
//
// Queries `mailings` specifically (not a bare `SELECT 1`) because a real
// incident proved connectivity alone isn't the thing worth verifying: the
// NAS ran for weeks against a database that still had the old, pre-migration
// `crm_state` table and none of the current schema - `SELECT 1` passed the
// whole time, since it only proves Postgres is reachable, not that this
// app's schema exists there. `select id from mailings limit 1` is the
// cheapest query that actually distinguishes the two cases: it succeeds
// (zero or more rows) against a real, migrated schema, however empty, and
// fails outright - a real Postgres error, caught below the same as a
// connection failure - if the table doesn't exist at all. That's the exact
// distinction that matters here; row content is never read or returned.
//
// build/commitSha (lib/build-info.ts) are the one deliberate exception to
// "nothing an unauthenticated caller shouldn't see," added so a deploy can
// be verified without signing in - the main way Brad would actually check
// one. Tradeoff, stated plainly rather than left implicit: this publishes
// a short commit SHA to anyone who can reach the port, unauthenticated. On
// a private NAS app that's negligible (the SHA alone reveals nothing
// about the code beyond what's already public in this open-source repo's
// own git history), but it IS a real exposure decision, not a neutral
// one - if that tradeoff isn't wanted, gating this response behind auth
// (or dropping just these two fields) is a one-line change, and that
// call belongs to Brad, not made silently here.
export async function GET() {
  // Computed before the DB check, and included either way below - the
  // version that's up is exactly what you want to know when Postgres
  // ISN'T reachable (a real 503 here is precisely the moment "did this
  // start after that deploy" matters most), not only on a clean bill of
  // health.
  const { buildTime, commitSha } = getBuildInfo();
  try {
    await getDb().select({ id: mailings.id }).from(mailings).limit(1);
    return Response.json({ status: "ok", buildTime, commitSha });
  } catch {
    return Response.json({ status: "error", buildTime, commitSha }, { status: 503 });
  }
}
