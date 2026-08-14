// Golden-HTML snapshot harness for public/app.js's twelve views - step 1 of
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
//    relying on public/app.js's own module-level state defaults - a
//    default changing later should not silently change what a snapshot
//    proves.
//
// One documented case where pinning genuinely can't reach further (not
// scrubbed - named plainly here and left as a real, open finding):
//  - number(value) in public/app.js calls `.toLocaleString()` with no
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
// defaultAutomationRules() in public/app.js falls back to it because
// automationRules isn't part of the spreadsheet shape at all. Needed here
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
// across every case's own fresh sandbox below.
const seedBuilderSandbox = loadAppJsSandbox(FIXED_NOW);
seedBuilderSandbox.window.EVERLETTER_SEED = { automationRules: AUTOMATION_RULES };
const seed = seedBuilderSandbox.buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)");

const avaSubscriber = seed.subscribers.find((subscriber) => subscriber.email === "ava.example@example.test");
assert.ok(avaSubscriber, "fixture invariant: Ava's subscriber should exist in the built seed");
const avaMarleySubscription = seed.subscriptions.find(
  (subscription) => subscription.subscriberId === avaSubscriber.subscriberId && subscription.character === "Marley",
);
assert.ok(avaMarleySubscription, "fixture invariant: Ava's Marley subscription should exist in the built seed");

// Common baseline every case starts from, then overrides only what that
// case is actually about - see the module comment above for why nothing is
// left to public/app.js's own defaults.
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
function renderCase(activeView, overrides) {
  const appJs = loadAppJsSandbox(FIXED_NOW, { captureRenders: true });
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
  ["queue", "queue", {}],
  ["exceptions", "exceptions", {}],
  ["subscribers", "subscribers", {}],
  ["import", "import", {}],
  ["print", "print", {}],
  ["qa", "qa", {}],
  ["packet", "packet", {}],
  ["bins", "bins", {}],
  ["launch", "launch", {}],
  ["samples", "samples", {}],
  // Previously the one case in this suite that wasn't timezone-stable:
  // renderSync() calls batchDatesForOrder() (public/app.js), which used to
  // serialize each generated date with `batch.toISOString().slice(0, 10)`
  // - unlike every other date serialization in this file (todayIso(),
  // formatDate(), nearestBatchDate()), which round-trip through
  // `date.getTime() - date.getTimezoneOffset() * 60000` first specifically
  // so the calendar date is stable regardless of runtime timezone. Fixed
  // directly in app.js to use the same correction (see that commit); this
  // snapshot was regenerated against the fixed output and is now verified
  // stable under TZ=Asia/Tokyo along with every other case in CASES.
  [
    "sync",
    "sync",
    {
      syncSubscriberId: avaSubscriber.subscriberId,
      syncSubscriptionId: avaMarleySubscription.subscriptionId,
    },
  ],
  ["automation", "automation", {}],
  // Separate states, not separate views (see the task this harness was built for).
  ["queue-batch-filter", "queue", { batchFilter: "2026-08-15" }],
  ["queue-status-filter", "queue", { statusFilter: "Mailed" }],
  ["subscribers-selected", "subscribers", { selectedSubscriberId: avaSubscriber.subscriberId }],
  ["queue-search", "queue", { query: "Ringo" }],
  ["exceptions-empty-search", "exceptions", { query: "zzz-nonexistent-zzz" }],
];

for (const [snapshotName, activeView, overrides] of CASES) {
  test(`renders ${snapshotName} deterministically, matching its committed snapshot`, () => {
    const html = renderCase(activeView, overrides);
    assert.ok(html.trim().length > 0, `${snapshotName} rendered empty HTML - a view that silently renders nothing would otherwise "pass" forever`);
    compareOrUpdateSnapshot(snapshotName, html);
  });
}

// The task this harness was built for assumed Ashley Bins renders both
// desktop rows and mobile cards into the same HTML, with an explicit
// instruction to confirm rather than assume it. Checking found the
// opposite: renderBins() (public/app.js) has no mobile-card markup at all -
// only two desktop sections, the summary bin-group cards and the detailed
// checklist table. The mobile card list (and the binMobileCard() function
// that renders it) lives in renderPacket() instead, under the confusingly
// bin-themed class name "bins-mobile-cards" and function name
// "binMobileCard" - a real naming/placement oddity in the current code,
// not a snapshotting gap, and not something this task fixes (no production
// code changes). Both assertions below check what's actually true, in the
// views that actually do it.
test("Ashley Bins renders its two desktop sections (summary cards and the detailed checklist table) - no mobile cards, verified rather than assumed", () => {
  const html = renderCase("bins", {});
  assert.match(html, /class="packet-grid bin-group-grid"/, "expected the summary bin-group cards");
  assert.match(html, /<table class="packet-table">/, "expected the desktop bin-row checklist table");
  assert.doesNotMatch(html, /mobile-card-list|binMobileCard/, "renderBins() has no mobile-card markup - if this starts matching, the finding above is stale and this test (and its comment) need updating");
});

test("Batch Packet renders both the desktop table and the mobile card list (the markup the Bins task description expected to find in Bins)", () => {
  const html = renderCase("packet", {});
  assert.match(html, /<table class="packet-table packet-final-table">/, "expected the desktop final-mailing-rows table");
  assert.match(html, /class="mobile-card-list bins-mobile-cards"/, "expected the mobile card list container");
});
