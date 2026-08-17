// Golden-HTML snapshot harness for app/crm/legacy-app.js's twelve views - step 1 of
// the app.js decomposition plan (see CLAUDE.md). Every later step of that
// plan is a refactor of the rendering this file snapshots; this suite is
// the safety net all of them assert against, so it needs no Postgres and no
// gitignored fixture and runs unconditionally as part of `pnpm test:unit` -
// no skip logic, anywhere, ever. See docs/testing.md for how to update a
// snapshot and why a diff in a refactor PR is a finding, not busywork.
//
// Determinism comes from controlling inputs, not scrubbing output:
//  - fixedNow pins the clock (see loadAppJsSandbox's own comment) so
//    todayIso()/overdue/dueNext14Days/nextBatchDate are all reproducible.
//    Chosen as UTC noon specifically so the local calendar date it produces
//    (via todayIso()'s getTimezoneOffset() round-trip, and formatDate()'s
//    parse-and-format-in-the-same-local-TZ round-trip) lands on the same
//    day in every timezone from roughly UTC-12 to UTC+12 - covering both
//    this machine's default TZ and TZ=Asia/Tokyo (UTC+9), which is what
//    this suite's own verification exercises. It is NOT safe against every
//    IANA offset that exists (UTC+13/+14 zones like Pacific/Kiritimati
//    would roll to the next calendar day) - noted here rather than solved,
//    since no realistic CI or developer machine runs in one of those.
//  - tests/fixtures/synthetic-rows.json is committed, synthetic spreadsheet
//    data (see its own row-by-row documentation below) - never the real,
//    gitignored testing/Import_20260812_181828.xlsx. That file is real
//    customer data; rendering it and committing the result would put real
//    names, emails, and addresses in a repository CLAUDE.md's data
//    boundary deliberately keeps sanitized, and the snapshots would be
//    unregenerable by anyone without that gitignored file. See CLAUDE.md.
//  - Every case assigns activeView/query/statusFilter/batchFilter/every
//    relevant selection explicitly (see caseState() below) rather than
//    relying on app/crm/legacy-app.js's own module-level state defaults - a
//    default changing later should not silently change what a snapshot
//    proves.
//
// One documented case where pinning genuinely can't reach further (not
// scrubbed - named plainly here and left as a real, open finding):
//  - number(value) in app/crm/legacy-app.js calls `.toLocaleString()` with no
//    explicit locale, which resolves against the process's default ICU
//    locale (a different axis than TZ, and not something loadAppJsSandbox
//    pins - see its own comment for why TZ specifically is safe). This
//    fixture's counts all stay under 1,000, where `.toLocaleString()`
//    output doesn't vary across locales (no thousands separator to
//    disagree about), so it doesn't manifest as a real difference here -
//    but it is a real, unpinned dependency, not a solved one, and a
//    fixture large enough to cross that threshold would need either a
//    locale-pinned reimplementation or an explicit normalization step this
//    one doesn't need.
//
// The "sync" case USED TO be a second, worse case here - not a pinning gap
// but a real app.js bug (batchDatesForOrder() serialized via
// `.toISOString()` with no getTimezoneOffset() correction, unlike every
// sibling date function, so it shifted dates under any positive-UTC-offset
// TZ). Fixed directly in app.js (see that commit) once this harness
// surfaced it via TZ=Asia/Tokyo - the fix mirrors nearestBatchDate()'s
// existing correction exactly. All 17 cases, sync included, are now
// verified stable under TZ=Asia/Tokyo (re-run after the fix, see PR #27's
// follow-up report). Left un-scrubbed here as a worked example: this
// harness didn't just document a timezone limitation, it found and enabled
// fixing a real one.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadAppJsSandbox, ROOT } from "./e2e-helpers.mjs";

const FIXTURE_PATH = path.join(ROOT, "tests/fixtures/synthetic-rows.json");
const SNAPSHOTS_DIR = path.join(ROOT, "tests/snapshots");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

// UTC noon - see the module comment above for why this specific instant.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");

// The app's own static automation-rules content (verbatim from
// public/everletterSeed.json/seed-data.js - not customer data, the app's
// own authored business-rule text, already public in this sanitized repo).
// Real app.js gets this from window.EVERLETTER_SEED, which the real page
// sets from that committed file before any spreadsheet is ever imported -
// defaultAutomationRules() (app/crm/views/import/import-selectors.ts, moved
// from app/crm/legacy-app.js in Phase 1 step 11 - CLAUDE.md) falls back to
// it because automationRules isn't part of the spreadsheet shape at all. Needed here
// only so the Automation view's snapshot has real content instead of an
// empty list; irrelevant to every other view.
const AUTOMATION_RULES = [
  { rule: "Mailing cadence", logic: "Everletter has two batch dates per month: the 1st and the 15th." },
  {
    rule: "3-day cutoff",
    logic: "A new subscription can join a batch when the signup/payment is at least roughly 3 days before the 1st or 15th. Otherwise it rolls to the next batch.",
  },
  {
    rule: "Spreadsheet bridge",
    logic: "Until Squarespace sync is live, import the updated Everletter Mailing Schedule through the Import Sheet screen.",
  },
];

// tests/fixtures/synthetic-rows.json, row by row - every name, email, and
// address is obviously fabricated (RFC 2606 .test emails, non-issued ZZ/
// 00000-series addresses), nothing derived from or resembling the real
// spreadsheet. Order IDs 5001-5011 are arbitrary. What each row is for:
//
//  5001 Ava Example / Marley / Month-to-month / To Prepare / ships 2026-08-15
//       Clean baseline row. Same person as 5002 (same email+name+address,
//       different character) - together they're the "one subscriber, two
//       subscriptions" case, and Ava is reused as the explicit selection
//       for the Sync view and the "subscriber selected" Subscribers case.
//  5002 Ava Example / Ringo / 6-month / To Prepare / ships 2026-09-01
//       Second subscription for the same subscriber as 5001. Covers the
//       6-month plan and a third distinct batch date.
//  5003 Ben Sample / Marley / 12-month / Printing / ships 2026-07-15
//       Covers the 12-month plan and a ship date in the past relative to
//       FIXED_NOW, so this mailing renders as overdue.
//  5004 Cara Placeholder / Ringo / Month-to-month / Assembling / 2026-08-15
//       A second Ringo row on the same batch date as 5001, distinguishing
//       per-character envelope-stock grouping from a shared "kid" bucket.
//  5005 Drew Instance / Penelope / Month-to-month / Ready to Mail / 2026-08-15
//       The only non-"kid" character in the fixture (envelopeStockForCharacter
//       buckets it as "Adult standard envelope" instead of a per-character
//       kid stock) - and a third distinct open status.
//  5006 Evan Testcase / Marley / Month-to-month / Mailed / ships 2026-07-01
//       Already Mailed. Invisible under the default status filter ('Open');
//       this is exactly what the "status filter applied" Queue case reveals
//       by switching to 'Mailed'.
//  5007 Faye Archived / Marley / Month-to-month / To Prepare / Active? = No
//       The one inactive/archived subscription. Otherwise clean - archived
//       rows are excluded from exception generation entirely (app.js only
//       evaluates spreadsheetExceptionReasons for Active rows), so this
//       tests the "archived, not flagged" path specifically.
//  5008 Gale Incomplete / Marley / (blank Subscription) / To Prepare
//       Blank plan normalizes to "Needs Review", producing a High-severity
//       "Missing subscription" exception.
//  5009 Hugo Nodate / Ringo / Month-to-month / To Prepare / (blank Ship Date)
//       The required "mailing with a missing ship date" - a High-severity
//       "Missing ship date" exception.
//  5010 Iris Noemail / Marley / Month-to-month / To Prepare / (blank Email)
//       A High-severity "Missing email" exception - a distinct High reason
//       from 5008/5009, so the Exceptions view isn't just one reason
//       repeated.
//  5011 Jax Offbatch / Ringo / Month-to-month / To Prepare / ships 2026-08-20
//       Ships on the 20th, not a 1st/15th batch date. This is the ONLY
//       reason string that produces Low severity rather than High (the
//       severity check is `reason.includes('Missing') ||
//       reason.includes('ship date')` - lowercase - and this reason is
//       "Ship date is not a 1st/15th batch", capital S, so it doesn't match
//       either check). Also the required second/third open batch date
//       alongside 2026-08-15 and 2026-09-01.
//
// Rows 5008-5010 (High severity) also carry a real business consequence
// worth knowing when reading the Queue/Print/QA-family snapshots: app.js
// pulls every mailing with a High-severity exception out of Production
// Queue, Batch Print, and Ashley Bins entirely (`highExceptionMailingIds`)
// until the exception is resolved - QA and Batch Packet are the exception,
// showing them so they can actually be fixed. Row 5011 (Low) is not pulled
// from anywhere.
const rows = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

// Built once, on a throwaway sandbox, through the real buildSeedFromSpreadsheet
// - not reimplemented. The resulting seed is a plain object, reused as-is
// across every case's own fresh sandbox below. now/automationRules are
// passed explicitly (step 3b threaded both in as real parameters - see
// lib/domain/spreadsheet/build-seed.ts's own header) - this used to go
// through a seedBuilderSandbox.window.EVERLETTER_SEED = {...} mutation
// instead, working around buildSeedFromSpreadsheet reading window/state
// internally for automationRules. That workaround is gone now that the
// function doesn't read either.
const seedBuilderSandbox = await loadAppJsSandbox(FIXED_NOW);
const seed = seedBuilderSandbox.buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, AUTOMATION_RULES);

// Common baseline every case starts from, then overrides only what that
// case is actually about - see the module comment above for why nothing is
// left to app/crm/legacy-app.js's own defaults.
function caseState(overrides) {
  return {
    query: "",
    statusFilter: "Open",
    batchFilter: "all",
    printScope: "all",
    printStockFilter: "all",
    packetScope: "all",
    sampleType: "Kid",
    selectedSubscriberId: "",
    syncSubscriberId: "",
    syncSubscriptionId: "",
    syncPlan: "Month-to-month",
    syncOrderDate: "2026-07-12",
    importPreview: null,
    importStatus: "",
    importBusy: false,
    importInfo: null,
    seed,
    ...overrides,
  };
}

// Renders one case in its own fresh sandbox (never reused across cases, so
// there is no risk of one case's state leaking into another) and returns
// the real, captured #viewMount HTML.
async function renderCase(activeView, overrides) {
  const appJs = await loadAppJsSandbox(FIXED_NOW, { captureRenders: true });
  Object.assign(appJs.state, caseState(overrides), { activeView });
  appJs.renderView();
  return appJs.getCapturedHtml("#viewMount");
}

function compareOrUpdateSnapshot(name, html) {
  const filePath = path.join(SNAPSHOTS_DIR, `${name}.html`);
  const normalized = html.endsWith("\n") ? html : `${html}\n`;
  if (UPDATE) {
    fs.writeFileSync(filePath, normalized);
    return;
  }
  assert.ok(
    fs.existsSync(filePath),
    `no committed snapshot at tests/snapshots/${name}.html - run UPDATE_SNAPSHOTS=1 pnpm test:unit to create it`,
  );
  const expected = fs.readFileSync(filePath, "utf8");
  assert.equal(
    normalized,
    expected,
    `tests/snapshots/${name}.html no longer matches. A snapshot diff in a refactor PR is a finding to explain, not a file to regenerate away - see docs/testing.md. If the new output is genuinely correct, rerun with UPDATE_SNAPSHOTS=1 and review the diff in the PR.`,
  );
}

const CASES = [
  // "queue" (plus its three filter-state variants, "queue-batch-filter"/
  // "queue-status-filter"/"queue-search", moved from the bottom of this
  // array alongside "subscribers-selected" et al.) were here through
  // step 12. Removed by step 13 (Phase 1's eighth view migration,
  // CLAUDE.md - the busiest operational screen in the app), same
  // treatment as every prior migrated view: moved to a real React
  // component (app/crm/views/queue/Queue.tsx) hosted outside #viewMount
  // entirely. tests/snapshots/queue.html, queue-batch-filter.html,
  // queue-status-filter.html, and queue-search.html are NOT deleted -
  // they're the four frozen references tests/queue-view.test.mjs
  // compares Queue.tsx's own rendered output against (all four states,
  // the reason those extra cases were captured in the first place), under
  // the same normalized comparison every other migrated view uses.
  // "exceptions" was here through step 9. Removed by step 10 (Phase 1's
  // fifth view migration, CLAUDE.md), same treatment as automation/
  // launch/sync/samples: moved to a real React component
  // (app/crm/views/exceptions/Exceptions.tsx) hosted outside #viewMount
  // entirely. tests/snapshots/exceptions.html and
  // tests/snapshots/exceptions-empty-search.html are NOT deleted - they're
  // the frozen references tests/exceptions-view.test.mjs compares
  // Exceptions.tsx's own rendered output against, under the same
  // normalized comparison automation/launch/sync/samples use. The
  // "exceptions-empty-search" case that used to live at the bottom of
  // this array (alongside the other separate-states-not-separate-views
  // entries) moved there too.
  // "subscribers" was here through step 11. Removed by step 12 (Phase
  // 1's seventh view migration, CLAUDE.md - the largest view migrated so
  // far), same treatment as automation/launch/sync/samples/exceptions/
  // import: moved to real React components
  // (app/crm/views/subscribers/{Subscribers,SubscriberProfile}.tsx)
  // hosted outside #viewMount entirely. tests/snapshots/subscribers.html
  // and tests/snapshots/subscribers-selected.html are NOT deleted -
  // they're the frozen references tests/subscribers-view.test.mjs
  // compares Subscribers.tsx's own rendered output against (both cases,
  // both including the mobile card list), under the same normalized
  // comparison every other migrated view uses. The "subscribers-selected"
  // case that used to live at the bottom of this array (alongside the
  // other separate-states-not-separate-views entries) moved there too.
  // "import" was here through step 10. Removed by step 11 (Phase 1's
  // sixth view migration, CLAUDE.md), same treatment as automation/
  // launch/sync/samples/exceptions: moved to a real React component
  // (app/crm/views/import/Import.tsx) hosted outside #viewMount
  // entirely. tests/snapshots/import.html is NOT deleted - it's the
  // frozen reference tests/import-view.test.mjs compares Import.tsx's
  // own rendered output against, under the same normalized comparison
  // automation/launch/sync/samples/exceptions use.
  ["print", "print", {}],
  // "qa" was here through step 13. Removed by step 14 (Phase 1's ninth
  // view migration, CLAUDE.md - the densest write surface in the app):
  // moved to a real React component (app/crm/views/qa/Qa.tsx) hosted
  // outside #viewMount entirely. tests/snapshots/qa.html is NOT deleted -
  // it's the frozen reference tests/qa-view.test.mjs compares Qa.tsx's
  // own rendered output against, under the same normalized comparison
  // every other migrated view uses.
  // "packet" was here through step 14. Removed by step 15 (Phase 1's
  // tenth view migration, CLAUDE.md - the largest snapshot in the whole
  // suite): moved to a real React component (app/crm/views/packet/Packet.tsx)
  // hosted outside #viewMount entirely. tests/snapshots/packet.html is NOT
  // deleted - it's the frozen reference tests/packet-view.test.mjs
  // compares Packet.tsx's own rendered output against (covering both the
  // desktop tables AND the mobile card list in one capture), under the
  // same normalized comparison every other migrated view uses.
  ["bins", "bins", {}],
  // "launch" removed by step 7 (Phase 1's second view migration -
  // CLAUDE.md), same reasoning as "automation" below: moved to a real
  // React component (app/crm/views/launch-plan/LaunchPlan.tsx), so
  // #viewMount is deliberately empty for it now. See
  // tests/launch-view.test.mjs for where this view's equivalence
  // coverage moved - tests/snapshots/launch.html is NOT deleted, same
  // treatment as automation.html.
  // "samples" was here through step 8. Removed by step 9 (Phase 1's
  // fourth view migration, CLAUDE.md), same treatment as automation/
  // launch/sync: moved to a real React component
  // (app/crm/views/samples/Samples.tsx) hosted outside #viewMount
  // entirely. tests/snapshots/samples.html is NOT deleted - it's the
  // frozen reference tests/samples-view.test.mjs compares Samples.tsx's
  // own rendered output against, under the same normalized comparison
  // automation/launch/sync use.
  // "sync" was here through step 7, timezone-fix history and all (see
  // this file's own module comment above for that bug/fix story - it
  // stays there since it's still true of the underlying rendering, just
  // no longer exercised via this harness). Removed by step 8 (Phase 1's
  // third view migration, CLAUDE.md), same treatment as "automation"/
  // "launch" below: moved to a real React component
  // (app/crm/views/sync/Sync.tsx) hosted outside #viewMount entirely.
  // tests/snapshots/sync.html is NOT deleted - it's the frozen reference
  // tests/sync-view.test.mjs compares Sync.tsx's own rendered output
  // against, under the same normalized comparison automation/launch use.
  // "automation" was here through step 5 - removed by step 6 (Phase 1's
  // first view migration, CLAUDE.md), which moved it to a real React
  // component (app/crm/views/Automation.tsx) hosted outside #viewMount
  // entirely (app/crm/CrmApp.tsx's portal seam, #reactViewMount in
  // app/page.tsx). This harness captures #viewMount only, so it has
  // nothing left to capture for a React-hosted view - #viewMount is
  // deliberately empty for "automation" now (app/crm/legacy-app.js's
  // renderView() clears it for any view with no `render` function), which
  // is exactly why line 268's "rendered empty HTML" guard below would
  // (correctly) flag it as broken if it were still in this list.
  // tests/snapshots/automation.html is NOT deleted - it's now the frozen
  // reference tests/automation-view.test.mjs compares the React
  // component's own rendered output against, under a normalized
  // comparison (see that file's header for why byte-identity isn't
  // achievable there). Every future migrated view leaves this list the
  // same way.
];

for (const [snapshotName, activeView, overrides] of CASES) {
  test(`renders ${snapshotName} deterministically, matching its committed snapshot`, async () => {
    const html = await renderCase(activeView, overrides);
    assert.ok(html.trim().length > 0, `${snapshotName} rendered empty HTML - a view that silently renders nothing would otherwise "pass" forever`);
    compareOrUpdateSnapshot(snapshotName, html);
  });
}

// Re-runs every CASES entry in the opposite order, step 4's own required
// verification (see CLAUDE.md/this step's PR description): step 4 moved
// `state` out of app/crm/legacy-app.js into lib/client/crm-state.ts's
// createCrmState() factory, and the hazard that step was built around is
// state leaking between cases if that factory were ever called at
// lib/client/crm-state.ts's own module scope instead of inside
// legacy-app.js. renderCase() still gives every case a fresh sandbox via
// loadAppJsSandbox() regardless of iteration order, so if isolation ever
// regressed, walking CASES backwards - last case first, first case last -
// is exactly what would surface a case's output depending on what ran
// before it. Same assertions, same committed snapshots as the suite above,
// just backwards.
for (const [snapshotName, activeView, overrides] of [...CASES].reverse()) {
  test(`renders ${snapshotName} deterministically in reverse iteration order too`, async () => {
    const html = await renderCase(activeView, overrides);
    compareOrUpdateSnapshot(snapshotName, html);
  });
}

// The task this harness was built for assumed Ashley Bins renders both
// desktop rows and mobile cards into the same HTML, with an explicit
// instruction to confirm rather than assume it. Checking found the
// opposite: renderBins() (app/crm/legacy-app.js) has no mobile-card markup at all -
// only two desktop sections, the summary bin-group cards and the detailed
// checklist table. The mobile card list lived in renderPacket() instead,
// under the confusingly bin-themed class name "bins-mobile-cards" - a real
// naming/placement oddity in the current code, not a snapshotting gap.
// Migrated to React in step 15 (Batch Packet - CLAUDE.md), which is why
// this file's own equivalent of "Batch Packet renders both the desktop
// table and the mobile card list" moved to tests/packet-view.test.mjs
// (Packet.tsx's own rendered output now, not this legacy sandbox) - the
// Ashley Bins half below is unaffected (still legacy, step 16 to migrate).
test("Ashley Bins renders its two desktop sections (summary cards and the detailed checklist table) - no mobile cards, verified rather than assumed", async () => {
  const html = await renderCase("bins", {});
  assert.match(html, /class="packet-grid bin-group-grid"/, "expected the summary bin-group cards");
  assert.match(html, /<table class="packet-table">/, "expected the desktop bin-row checklist table");
  assert.doesNotMatch(html, /mobile-card-list|binMobileCard/, "renderBins() has no mobile-card markup - if this starts matching, the finding above is stale and this test (and its comment) need updating");
});
