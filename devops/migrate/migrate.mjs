#!/usr/bin/env node
// Runs `drizzle-orm/node-postgres/migrator`'s migrate() against DATABASE_URL -
// the same mechanism `drizzle-kit migrate` uses under the hood, so a database
// this touches stays interchangeable with one migrated by `pnpm db:migrate`
// (same drizzle.__drizzle_migrations bookkeeping, same hash/journal format).
//
// Lives in its own package.json (./package.json, sibling to this file),
// deliberately NOT part of the main pnpm workspace or its lockfile. Why: the
// app's own production image (devops/app.Dockerfile's runner stage) never
// gets a real node_modules for drizzle-orm - Next's build bundles/inlines it
// directly into the compiled route chunks, which is exactly why the app
// itself works fine without one, but means an unbundled standalone script
// like this one can't reach it via a bare `import "drizzle-orm/..."` the way
// application code can. The two options that don't have this problem: (1)
// hand-vendor just the specific drizzle-orm files this script touches, which
// turned out to mean the whole node-postgres driver's real dependency
// subgraph (pg-core/dialect.js, relations.js, sql/sql.js, and more) - fragile
// and liable to silently break on a drizzle-orm version bump; (2) give this
// script its own tiny, real `npm install`, isolated from the app's own
// dependency graph entirely. This is (2) - see devops/app.Dockerfile's
// runner stage for where that install happens (a real `npm install`, not a
// cross-stage COPY of the builder's full node_modules - copying large,
// many-file directories across build stages is what hangs on this host's
// overlay2 driver, see that Dockerfile's own comment on the builder stage).
//
// Run via `devops/devops.sh migrate` (dev box, using DATABASE_URL from
// .env.local) or `docker compose run --rm app node devops/migrate/migrate.mjs`
// against the pulled image (devops/deploy.sh, NAS - no Node toolchain needed
// on the host either way, since this runs inside the container).
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// devops/migrate/migrate.mjs -> ../../drizzle, so this resolves correctly
// regardless of the caller's own working directory.
const migrationsFolder = join(__dirname, "..", "..", "drizzle");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  const db = drizzle(pool);
  console.log(`Applying migrations from ${migrationsFolder} ...`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully (or already up to date).");
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
