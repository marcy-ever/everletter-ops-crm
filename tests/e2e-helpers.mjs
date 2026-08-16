// Shared setup for tests/*.e2e.test.mjs files (build-dataset-from-tables,
// write-to-tables-transactional, shared-state-get). Each of those files opened
// with an identical copy-pasted preamble - env loading, a sandboxed
// app/crm/legacy-app.js loader, the truncate statement, and the has-fixture/has-db
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
import { fileURLToPath, pathToFileURL } from "node:url";
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

const LEGACY_APP_URL = pathToFileURL(path.join(ROOT, "app/crm/legacy-app.js")).href;
// The real, unpatched Date - captured once, at module load, before any call
// below might replace globalThis.Date with a FixedDate. Needed so a later
// call made *without* fixedNow can reliably restore the real clock, even
// after an earlier call in the same file installed a fixed one (see the
// fixedNow handling below).
const RealDate = globalThis.Date;
let importSequence = 0;

// Runs the real app/crm/legacy-app.js (an ES module, since the app.js ->
// ESM move) via a real dynamic import() and returns a wrapper exposing its
// exports, so tests can call its real functions (buildSeedFromSpreadsheet,
// etc.) instead of a reimplementation.
//
// Before that move, this ran app.js as text through `vm.Script` in an
// isolated context - genuinely isolated from both the real Node globals and
// every other call's context. Now that the module has real `export`
// statements, `vm.Script` can't run it at all (export is a syntax error
// outside module context), and a real ES module can only be loaded through
// real module machinery (import()), which resolves against Node's single,
// process-wide module cache and the real globalThis - not an isolated
// context. This function reconstructs the properties the old isolation
// gave tests, deliberately, rather than pretending nothing changed:
//
//  - Fresh module state per call: dynamic import() caches by the exact
//    resolved specifier, so importing the same path twice returns the SAME
//    module instance (same `state` object, same already-true `initialized`
//    guard) - wrong for tests/render-snapshots.test.mjs, which loads a
//    fresh sandbox per case specifically so no case's state can leak into
//    another's. Fixed by appending a `?t=<counter>` cache-busting query
//    string to the specifier on every call, forcing a full re-evaluation
//    each time. (tests/ts-extensionless-loader.mjs, the loader hook already
//    registered for every test run, passes non-relative specifiers - this
//    one included - straight through to Node's default resolver, which
//    handles the query string correctly: same file on disk, distinct cache
//    entry.)
//  - document/window/localStorage/fetch: legacy-app.js's functions
//    reference these as bare identifiers, which - now that the module runs
//    in the real Node realm instead of a vm context - resolve against the
//    real process-wide `globalThis`, not a per-call sandbox object. So
//    this installs the same stubs used before directly onto `globalThis`
//    before importing, and initCrmApp() (called immediately after import -
//    see below) reads them from there. This is real, shared, mutable
//    state: the stubs installed by the MOST RECENT call are what every
//    sandbox's functions see if called afterward, regardless of which
//    call's wrapper object they were reached through. This is safe under
//    this suite's actual usage (node:test runs tests within one file
//    sequentially - see docs/testing.md - and no test file interleaves
//    calls to two different loadAppJsSandbox() results), but it is a real
//    behavior change from vm's per-context isolation and would matter if a
//    future test tried to hold two sandboxes "live" at once.
//  - fixedNow (optional, unchanged meaning): when passed, `new Date()` (no
//    args) and `Date.now()` inside the module resolve to that exact instant
//    instead of the real clock - required by build-dataset-from-tables.e2e,
//    which pins both the client-side seed's "now" and
//    buildDatasetFromTables()'s "now" to the same instant so
//    summary.asOf/overdue/dueNext14Days aren't polluted by a frozen-vs-live
//    day-boundary artifact (see lib/mailing-rules.ts's module comment).
//    Every call sets globalThis.Date explicitly - to a FixedDate when
//    fixedNow is given, back to the real Date otherwise - so one call's
//    fixedNow can never leak into a later call that didn't ask for it.
//  - captureRenders (default false, opt-in): turns on two things
//    tests/render-snapshots.test.mjs needs and nothing else uses -
//    document.querySelector(selector)'s stub elements actually retain their
//    innerHTML instead of discarding it (memoized by selector so the
//    harness can read back what a given mount, e.g. '#viewMount', was last
//    written to) and getCapturedHtml(selector) to read it. `state` is now a
//    real named export (see legacy-app.js's export list) - no bridging
//    hack needed to reach it, unlike the vm/const-scoping workaround this
//    replaced.
//
// initCrmApp() (a real export, see legacy-app.js) is called here, once,
// immediately after import - matching how the module used to run its own
// initialization automatically at the bottom of the file when `vm.Script`
// executed it top to bottom. window.EVERLETTER_SEED is left undefined in
// this harness, so initCrmApp() -> initializeCrm() just writes a "could not
// load" message into the stubbed #viewMount and returns, same as before.
export async function loadAppJsSandbox(fixedNow, { captureRenders = false } = {}) {
  const elementsBySelector = new Map();

  function makeStubElement() {
    let html = "";
    const base = {
      addEventListener() {},
      querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {},
      dataset: {},
      getAttribute: () => null,
      setAttribute() {},
      // Nested lookups (e.g. viewMount.querySelector('[data-bin-print]'))
      // are for wiring event listeners, never for reading back captured
      // output - a fresh, unmemoized stub each time matches the pre-existing
      // behavior and is all any call site needs (several call this without
      // optional chaining, so it must never return null/undefined).
      querySelector: () => makeStubElement(),
    };
    if (captureRenders) {
      return {
        ...base,
        get innerHTML() {
          return html;
        },
        set innerHTML(value) {
          html = value;
        },
      };
    }
    return {
      ...base,
      get innerHTML() {
        return "";
      },
      set innerHTML(_value) {},
    };
  }

  function queryDocument(selector) {
    if (!captureRenders) return makeStubElement();
    if (!elementsBySelector.has(selector)) elementsBySelector.set(selector, makeStubElement());
    return elementsBySelector.get(selector);
  }

  // visibilityState/addEventListener('visibilitychange', ...) - added for
  // the change-marker staleness feature's tab-hidden pause/resume
  // behavior (app/crm/legacy-app.js's initCrmApp()). Every earlier feature
  // this stub supported only ever needed document.querySelector(); this is
  // the first one that genuinely listens for a document-level event, so
  // there was nothing to reuse - minimal on purpose (only the
  // 'visibilitychange' type is handled), and returned to callers via
  // setDocumentVisibility() below rather than exposing the listener set
  // directly, so a test simulates the same real-world trigger (the
  // visibilityState property changing, then the event firing) instead of
  // reaching in and calling a captured listener by hand.
  let visibilityState = "visible";
  const visibilityListeners = new Set();
  globalThis.document = {
    querySelector: queryDocument,
    querySelectorAll: () => [],
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListeners.delete(listener);
    },
  };
  globalThis.window = { EVERLETTER_SEED: undefined, location: { hash: "" } };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

  if (fixedNow) {
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixedNow.getTime());
        else super(...args);
      }
      static now() {
        return fixedNow.getTime();
      }
    }
    globalThis.Date = FixedDate;
  } else {
    globalThis.Date = RealDate;
  }

  const mod = await import(`${LEGACY_APP_URL}?t=${importSequence++}`);
  mod.initCrmApp();

  return {
    ...mod,
    window: globalThis.window,
    getCapturedHtml: (selector) => elementsBySelector.get(selector)?.innerHTML ?? "",
    // Simulates the real trigger for a 'visibilitychange' event (the
    // property changing, then the event firing) - see the document stub
    // above. Deliberately named "set...Visibility" rather than
    // "dispatchEvent" or similar: callers should think in terms of the
    // real-world state a test wants to simulate, not the DOM plumbing.
    setDocumentVisibility(next) {
      visibilityState = next;
      visibilityListeners.forEach((listener) => listener());
    },
  };
}
