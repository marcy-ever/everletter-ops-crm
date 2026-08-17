// Shared setup for tests/*.e2e.test.mjs files (build-dataset-from-tables,
// write-to-tables-transactional, shared-state-get). Each of those files opened
// with an identical copy-pasted preamble - env loading, the truncate
// statement, and the has-fixture/has-db skip gates - and the duplication
// had already caused real drift. It had also produced a real bug: the
// .env.local read used fs.readFileSync with no existence check, at module
// top level, so a machine with no .env.local threw ENOENT before any
// `skip` gate ran - contradicting every file's own docstring claim that
// missing local infra means "skipped, not failed." See
// tests/db-test-helpers.mjs's comment for why that module stayed separate
// rather than being folded in here.
//
// The loadAppJsSandbox() vm/dynamic-import harness that used to live here
// (a real dynamic import() of app/crm/legacy-app.js, `?t=<counter>`
// cache-busting for fresh module state, and document/window/localStorage/
// fetch stubs installed on globalThis) is gone along with legacy-app.js
// itself (Phase 2 of the app.js decomposition - CLAUDE.md, the monolith's
// deletion). What it existed to reach - state/its mutators, VIEW_REGISTRY,
// the shell's own render functions - now live in app/crm/shell/ as plain,
// directly-importable modules; app/crm/shell/crm-app-state.ts's
// createAppState() replaces the cache-busting trick with an ordinary
// factory call for tests that need a fresh, isolated instance (see that
// module's own header). Tests that genuinely need document/window stubs
// (the shell's own DOM-wiring/visibility tests) now build their own small,
// purpose-built stub locally rather than sharing one generic sandbox meant
// to reach into a monolith that no longer exists.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { subscribers } from "../db/schema/subscribers";
import { subscriptions } from "../db/schema/subscriptions";
import { orders } from "../db/schema/orders";
import { mailings } from "../db/schema/mailings";
import { mailingComponents } from "../db/schema/mailing_components";
import { exceptions } from "../db/schema/exceptions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const XLSX_PATH = path.join(ROOT, "testing/Import_20260812_181828.xlsx");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

export const hasDbUrl = !!process.env.DATABASE_URL;
export const hasFixture = fs.existsSync(XLSX_PATH);

// A skip reason string (truthy, and shown by node:test as the reason for
// the skip in its output - see each test's own { skip } option) if this
// environment can't run e2e tests, or `false` if it can. One definition so
// every e2e file reports the identical, unmistakable reason instead of
// silently no-opping - a green `pnpm test` where e2e quietly skipped
// everything is the exact false-gate failure mode this module exists to
// prevent.
export function e2eSkipReason({ requiresFixture = true } = {}) {
  const reasons = [];
  if (!hasDbUrl) {
    reasons.push("DATABASE_URL is not set (no .env.local, or DATABASE_URL missing from it - see docs/testing.md)");
  }
  if (requiresFixture && !hasFixture) {
    reasons.push(`test fixture not found at ${path.relative(ROOT, XLSX_PATH)} (gitignored, developer-local - see docs/testing.md)`);
  }
  return reasons.length ? `e2e prerequisites missing: ${reasons.join("; ")}` : false;
}

// Truncates every normalized table an import writes to. Kept as one
// definition specifically because this list has to be kept in sync with
// db/schema/ by hand - a table added later and missed in one copy used to
// be able to degrade test isolation silently in whichever file didn't get
// the memo. Imports the real Drizzle table objects (rather than a raw SQL
// identifier string) deliberately: a table rename in db/schema/ then fails
// this module's own import at load time instead of silently truncating
// nothing for a name that no longer exists.
export async function truncateAllTables(db) {
  await db.execute(sql`TRUNCATE TABLE ${mailingComponents}, ${exceptions}, ${mailings}, ${orders}, ${subscriptions}, ${subscribers} RESTART IDENTITY CASCADE`);
}

// Parses the real test spreadsheet the same way for every file that needs
// client-side rows to build a seed from (buildSeedFromSpreadsheet, imported
// directly from lib/domain/spreadsheet/build-seed.ts by every consumer now).
export function loadSpreadsheetRows() {
  const workbook = XLSX.read(fs.readFileSync(XLSX_PATH), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes("mailing")) || workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
}

