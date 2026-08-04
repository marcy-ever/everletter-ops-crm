// TEMPORARY: this D1 (Cloudflare Worker) binding helper was disconnected as
// part of dropping the Cloudflare Worker/Sites runtime. It is not currently
// called by any live route (only by the unused `examples/d1` starter code).
// Persistence is being migrated to self-hosted Postgres via Drizzle in a
// follow-up step, which will replace this with a real `drizzle-orm/node-postgres`
// (or similar) connection.

export function getDb(): never {
  throw new Error(
    "Database access is not available yet: the Cloudflare D1 binding was removed and the Postgres connection has not been wired up yet."
  );
}
