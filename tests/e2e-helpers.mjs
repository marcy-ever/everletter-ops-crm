// Shared setup for tests/*.e2e.test.mjs files (build-dataset-from-tables,
// write-to-tables-transactional, shared-state-get). Each of those files opened
// with an identical copy-pasted preamble - env loading, a sandboxed
// public/app.js loader, the truncate statement, and the has-fixture/has-db
// skip gates - and the duplication had already caused real drift: the
// build-dataset-from-tables copy of loadAppJsSandbox() had the fixedNow
// time-pinning (see its own comment below), the shared-state-get copy
// didn't. It had also produced a real bug: the .env.local read used
// fs.readFileSync with no existence check, at module top level, so a
// machine with no .env.local threw ENOENT before any `skip` gate ran -
// contradicting every file's own docstring claim that missing local infra
// means "skipped, not failed." See tests/db-test-helpers.mjs's comment for
// why that module stayed separate rather than being folded in here.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
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
// client-side rows to feed into the sandboxed app.js.
export function loadSpreadsheetRows() {
  const workbook = XLSX.read(fs.readFileSync(XLSX_PATH), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes("mailing")) || workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
}

// Runs the real public/app.js in a sandboxed vm context and returns it, so
// tests can call its real functions (buildSeedFromSpreadsheet, etc.)
// instead of a reimplementation.
//
// fixedNow is optional. When passed, `new Date()` (no args) and `Date.now()`
// inside the sandbox resolve to that exact instant instead of the real
// clock - required by build-dataset-from-tables.e2e, which pins both the
// client-side seed's "now" and buildDatasetFromTables()'s "now" to the same
// instant so summary.asOf/overdue/dueNext14Days aren't polluted by a
// frozen-vs-live day-boundary artifact (see lib/mailing-rules.ts's module
// comment). Tests that don't care about time-dependent fields (e.g.
// shared-state-get.e2e) simply omit it and get the real clock, unchanged
// from before this was unified.
export function loadAppJsSandbox(fixedNow) {
  const source = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");

  function stubElement() {
    return {
      addEventListener() {},
      querySelector: () => stubElement(),
      querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {},
      dataset: {},
      getAttribute: () => null,
      setAttribute() {},
      set innerHTML(_value) {},
      get innerHTML() {
        return "";
      },
    };
  }

  const sandbox = {
    document: { querySelector: () => stubElement(), querySelectorAll: () => [] },
    window: { EVERLETTER_SEED: undefined, location: { hash: "" } },
    console,
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    TextEncoder,
  };

  if (fixedNow) {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixedNow.getTime());
        else super(...args);
      }
      static now() {
        return fixedNow.getTime();
      }
    }
    sandbox.Date = FixedDate;
  }

  vm.createContext(sandbox);
  new vm.Script(source, { filename: "public/app.js" }).runInContext(sandbox);
  return sandbox;
}
