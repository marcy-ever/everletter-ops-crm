// Verifies the write paths app/crm/CrmApp.tsx's REACT_VIEWS.qa entry
// drives - Phase 1 step 14 (CLAUDE.md), the densest write surface in the
// app: seven independently-editable component-status fields per row, plus
// two batch actions ([data-qa-mark-ready]/[data-qa-mark-mailed]) migrated
// exactly as they are (no confirmation, no batching, no undo - Marcy's
// decision to make, not this branch's to act on).
//
// Everything the server side of a componentStatus/mailingStatus write does
// (validation, audit log, key matching) is already covered end to end by
// tests/audit-events.e2e.test.mjs - not re-proven here. What's new, and
// what this file exists to prove:
//  1. each of the seven fields writes through the correct path (envelope
//     goes through updateEnvelopeStatus, everything else through
//     updateComponentStatus - same branch app/crm/CrmApp.tsx's
//     onFieldChange makes) and produces exactly one audit row, with no
//     self-inflicted staleness banner.
//  2. the exception-dependent default gap step 4 of the decomposition
//     first flagged (lib/client/selectors.ts's componentStatus/
//     defaultComponentStatus depend on seed+reviewed, not just
//     componentOverrides) actually holds against a REAL imported/
//     reconstructed dataset, not just hand-built fixture objects - a row
//     with an active High exception and one without render different
//     payment/qa defaults.
//  3. onMarkReady's multi-field-per-row loop, at scale: audit row count
//     matches the real number of writes it actually issues (5 fields per
//     qualifying row - envelope/letter/artifact/insert conditionally, qa
//     unconditionally - not 1, unlike Production Queue's single-field bulk
//     action), a batch where every write fails still collapses into ONE
//     counted failure message, and the staleness store's highest-wins
//     property (lib/client/staleness.ts's recordOwnMarker) holds for a
//     componentStatus-kind write specifically (step 13/Queue only proved
//     it for mailingStatus).
//  4. onMarkMailed's simpler, Queue-shaped bulk write (one
//     updateMailingStatus call per already-ready row) at scale.
//
// globalThis.fetch is rewired to call app/api/shared-state/route.ts's
// real POST/GET handlers directly, in-process, against a real Postgres -
// same wireFetchToRealRoute/waitForFetches technique steps 10-13
// established.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped,
// not failed, if it isn't available. Run through `pnpm test:e2e`.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, loadAppJsSandbox, truncateAllTables } from "./e2e-helpers.mjs";
import { componentKey, mailingKey } from "../lib/domain/keys.ts";
import { QA_FIELDS, printedEnvelopeStatusForMailing, computeQaData } from "../app/crm/views/qa/qa-selectors.ts";

const skip = e2eSkipReason({ requiresFixture: false });
const NO_LETTER_FOLDER = () => "";

// plan "One-time" is one of the four plans write-to-tables.ts's real
// server-side import actually accepts (LETTERS_BY_PLAN, lib/write-to-tables.ts
// - "Month-to-month"/"6-month"/"12-month"/"One-time"; anything else is
// silently skipped as "unrecognized plan", confirmed directly by hitting
// exactly that skip with an earlier, made-up plan string). Also, like
// "Month-to-month", it isn't "6-month"/"12-month" - printModeForPlan
// (lib/domain/plans.ts) falls through to "Special" for it, giving the same
// isPrepaid: false (envelope/letter both default to "Need Print") -
// but WITHOUT "Month-to-month"'s own updateEnvelopeStatus fan-out
// (lib/client/crm-state.ts's monthlyEnvelopeTargets only fans out when
// mailing.plan === exactly "Month-to-month") - keeps each field's write
// count at exactly one per row, so the audit-row arithmetic below stays
// simple and exact.
function buildMailing(n, overrides = {}) {
  const id = `T${n}`;
  return {
    subscriberId: `SUB-${id}`,
    subscriptionId: `PLAN-${id}`,
    recipientId: `REC-${id}`,
    orderId: `ORD-${id}`,
    mailingId: `MAIL-${id}`,
    character: "Marley",
    plan: "One-time",
    recipientName: `Test Recipient ${id}`,
    letterNumber: 1,
    shipDate: "2026-08-15",
    status: "To Prepare",
    activeState: "Active",
    notes: "",
    sourceRow: n,
    ...overrides,
  };
}

function buildSeed(mailingSpecs) {
  return {
    subscribers: mailingSpecs.map((m) => ({ subscriberId: m.subscriberId, email: `${m.subscriberId}@example.test`, displayName: m.recipientName, status: "Active" })),
    recipients: mailingSpecs.map((m) => ({ recipientId: m.recipientId, subscriberId: m.subscriberId, name: m.recipientName, address: "1 Test St" })),
    subscriptions: mailingSpecs.map((m) => ({
      subscriptionId: m.subscriptionId,
      subscriberId: m.subscriberId,
      recipientId: m.recipientId,
      plan: m.plan,
      character: m.character,
      startDate: "2026-01-01",
      endDate: "",
      activeState: "Active",
    })),
    orders: mailingSpecs.map((m) => ({ orderId: m.orderId, subscriberId: m.subscriberId, sourceOrderNumber: m.orderId, createdOn: "2026-01-01" })),
    mailings: mailingSpecs.map((m) => ({
      mailingId: m.mailingId,
      subscriberId: m.subscriberId,
      subscriptionId: m.subscriptionId,
      recipientId: m.recipientId,
      orderId: m.orderId,
      character: m.character,
      plan: m.plan,
      recipientName: m.recipientName,
      letterNumber: m.letterNumber,
      shipDate: m.shipDate,
      status: m.status,
      activeState: m.activeState,
      notes: m.notes,
      sourceRow: m.sourceRow,
    })),
    exceptions: [],
    automationRules: [],
    summary: {},
  };
}

function buildCrmDatasetBody(seed, { sourceName = "test-fixture.xlsx" } = {}) {
  const value = JSON.stringify({ seed, sourceName, uploadedAt: new Date().toISOString(), summary: {} });
  return JSON.stringify({ kind: "crmDataset", key: "current", value });
}

function postRequest(body) {
  return new Request("http://localhost/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function loadRoute() {
  return import("../app/api/shared-state/route");
}

async function freshDb() {
  const { getDb } = await import("../db");
  const db = getDb();
  await truncateAllTables(db);
  const { auditEvents } = await import("../db/schema/audit_events");
  await db.delete(auditEvents);
  return db;
}

async function importSeed(POST, seed, sourceName) {
  const response = await POST(postRequest(buildCrmDatasetBody(seed, { sourceName })));
  assert.equal(response.status, 200, `seeding failed: ${JSON.stringify(await response.json().catch(() => null))}`);
}

// Same wireFetchToRealRoute/waitForFetches technique as steps 10-13's own
// e2e write-path files - see any of their headers for why a bare
// setTimeout(resolve, 0) flush isn't enough once fetch does real I/O.
// Must be wired AFTER loadAppJsSandbox(), which stubs globalThis.fetch
// itself.
function wireFetchToRealRoute(POST) {
  const pending = [];
  globalThis.fetch = (url, options = {}) => {
    const request = new Request(`http://localhost${url}`, options);
    const promise = POST(request);
    pending.push(promise);
    return promise;
  };
  return {
    async waitForFetches() {
      await Promise.all(pending);
      pending.length = 0;
    },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.qa onFieldChange body exactly -
// not a re-implementation.
function fireFieldChange(sandbox, mailing, field, value) {
  if (field === "envelope") {
    sandbox.updateEnvelopeStatus(mailing, value);
  } else {
    sandbox.updateComponentStatus(mailing, field, value);
  }
}

test("each of the seven component-status fields, changed individually, sends the correct POST, writes exactly one audit row, and doesn't trip this user's own staleness banner", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  const seed = buildSeed([spec]);
  await importSeed(POST, seed, "seed.xlsx");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  const { waitForFetches } = wireFetchToRealRoute(POST);
  const mailing = seed.mailings[0];

  for (const field of QA_FIELDS) {
    // Pick a value different from the field's computed default, so the
    // write is a real change, not a soft-skip.
    const newValue = field.options.find((option) => option !== field.options[0]) || field.options[0];
    fireFieldChange(sandbox, mailing, field.key, newValue);
    await waitForFetches();
    await flush();

    const key = componentKey(mailing, field.key);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.itemKey, key));
    assert.equal(rows.length, 1, `field "${field.key}" should have produced exactly one audit row`);
    assert.equal(rows[0].kind, "componentStatus");
    assert.equal(rows[0].newValue, newValue, `field "${field.key}"'s audit row should record the new value`);

    const snapshot = sandbox.staleness.getSnapshot();
    assert.equal(snapshot.stale, false, `changing field "${field.key}" must not make this same client's own page look stale`);
  }
});

test("a row with an active High exception and one without render different payment/qa defaults, against a REAL imported and reconstructed dataset", { skip }, async () => {
  const { POST, GET } = await loadRoute();
  await freshDb();

  const clean = buildMailing(1);
  const flagged = buildMailing(2);
  const seed = buildSeed([clean, flagged]);
  seed.exceptions = [
    {
      exceptionId: "EXC-FLAGGED",
      severity: "High",
      reason: "Missing address",
      mailingId: flagged.mailingId,
      subscriberId: flagged.subscriberId,
      recipientName: flagged.recipientName,
      shipDate: flagged.shipDate,
      suggestedShipDate: flagged.shipDate,
      status: flagged.status,
      sourceRow: flagged.sourceRow,
    },
  ];
  await importSeed(POST, seed, "seed.xlsx");

  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  const reviewed = new Set(body.reviewed);

  const data = computeQaData(body.dataset, {}, reviewed, body.componentOverrides, "all", "all", "", "2026-08-12", NO_LETTER_FOLDER);
  const cleanRow = data.rows.find((row) => row.mailing.mailingId === clean.mailingId);
  const flaggedRow = data.rows.find((row) => row.mailing.mailingId === flagged.mailingId);
  assert.ok(cleanRow && flaggedRow, "both rows should be present - QA never filters out high-exception mailings");

  assert.equal(cleanRow.fieldValues.payment, "Active");
  assert.equal(cleanRow.fieldValues.qa, "Open");
  assert.equal(flaggedRow.fieldValues.payment, "Needs Check", "an active High exception flips the payment default");
  assert.equal(flaggedRow.fieldValues.qa, "Problem", "an active High exception flips the qa default");
  assert.equal(cleanRow.isReady, false, "neither row is fully ready by default (envelope/letter/artifact/insert/qa all still need work)");
  assert.equal(flaggedRow.needsAttention, true);
});

test("onMarkReady at scale writes exactly the real number of changes it issues - up to five component-status fields per qualifying row, not one", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const ROW_COUNT = 10;
  const specs = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  const seed = buildSeed(specs);
  await importSeed(POST, seed, "seed.xlsx");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  const { waitForFetches } = wireFetchToRealRoute(POST);

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.qa onMarkReady body exactly,
  // computing each row's fieldValues via computeQaData first (the same
  // pre-render snapshot the real callback closes over), not re-deriving
  // defaults by hand.
  const data = computeQaData(seed, {}, new Set(), {}, "all", "all", "", "2026-08-12", NO_LETTER_FOLDER);
  assert.equal(data.rows.length, ROW_COUNT, "fixture invariant: every row should be shown");

  data.rows
    .filter((row) => row.fieldValues.payment === "Active")
    .forEach((row) => {
      const mailing = row.mailing;
      if (row.fieldValues.envelope === "Need Print") sandbox.updateEnvelopeStatus(mailing, printedEnvelopeStatusForMailing(row));
      if (row.fieldValues.letter === "Need Print") sandbox.updateComponentStatus(mailing, "letter", "Stuffed");
      if (row.fieldValues.artifact === "Need Check") sandbox.updateComponentStatus(mailing, "artifact", "Packed");
      if (row.fieldValues.insert === "Need Check") sandbox.updateComponentStatus(mailing, "insert", "Packed");
      sandbox.updateComponentStatus(mailing, "qa", "Ready");
    });
  await waitForFetches();
  await flush();

  // This fixture's defaults (plan "3-month", character "Marley"): payment
  // "Active", envelope "Need Print", letter "Need Print", artifact "Need
  // Check", insert "Need Check" (marley), qa "Open" - all five
  // conditionals fire for every row, so the real write count is exactly
  // ROW_COUNT * 5, not ROW_COUNT * 1 the way Production Queue's
  // single-field bulk action would be.
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(rows.length, ROW_COUNT * 5, "exactly one audit row per field actually changed, across every qualifying row");

  const byField = {};
  for (const row of rows) {
    const field = row.itemKey.split("::")[2];
    byField[field] = (byField[field] || 0) + 1;
  }
  assert.deepEqual(byField, { envelope: ROW_COUNT, letter: ROW_COUNT, artifact: ROW_COUNT, insert: ROW_COUNT, qa: ROW_COUNT });

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "the actor's own batch action must not make their own page look stale either");
});

test("onMarkReady where every write fails collapses into ONE counted failure message, not one per field per row", { skip }, async () => {
  await freshDb();
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  // A genuine network failure (fetch rejects), same shape a dropped
  // connection mid-batch-action would produce - saveSharedState's own
  // .catch branch (lib/client/shared-state-client.ts) handles this for
  // real.
  globalThis.fetch = () => Promise.reject(new Error("simulated network failure"));

  const ROW_COUNT = 6;
  const specs = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  const seed = buildSeed(specs);
  const data = computeQaData(seed, {}, new Set(), {}, "all", "all", "", "2026-08-12", NO_LETTER_FOLDER);

  data.rows
    .filter((row) => row.fieldValues.payment === "Active")
    .forEach((row) => {
      const mailing = row.mailing;
      if (row.fieldValues.envelope === "Need Print") sandbox.updateEnvelopeStatus(mailing, printedEnvelopeStatusForMailing(row));
      if (row.fieldValues.letter === "Need Print") sandbox.updateComponentStatus(mailing, "letter", "Stuffed");
      if (row.fieldValues.artifact === "Need Check") sandbox.updateComponentStatus(mailing, "artifact", "Packed");
      if (row.fieldValues.insert === "Need Check") sandbox.updateComponentStatus(mailing, "insert", "Packed");
      sandbox.updateComponentStatus(mailing, "qa", "Ready");
    });
  await flush();

  const EXPECTED_FAILURES = ROW_COUNT * 5;
  const snapshot = sandbox.saveFailures.getSnapshot();
  assert.equal(snapshot.failedSaveCount, EXPECTED_FAILURES);

  const html = sandbox.getCapturedHtml("#saveFailureBanner");
  assert.match(html, new RegExp(`${EXPECTED_FAILURES} changes couldn.{1,8}t be saved`));
  // Counted, not enumerated - exactly one <p> for the save-failure
  // message, not thirty (tests/save-failure-banner.test.mjs already
  // proves the general mechanism; reconfirmed here against a real
  // rejected POST fired through onMarkReady's actual multi-field loop
  // shape).
  assert.equal((html.match(/<p>/g) || []).length, 1);
});

test("onMarkMailed at scale writes exactly one audit row per already-ready row (the same shape as Production Queue's bulk action)", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const ROW_COUNT = 8;
  const specs = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  const seed = buildSeed(specs);
  await importSeed(POST, seed, "seed.xlsx");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  const { waitForFetches } = wireFetchToRealRoute(POST);

  // Populate this client's own componentOverrides directly, simulating
  // rows already marked fully ready in an earlier action/session -
  // isolates onMarkMailed's own updateMailingStatus loop from onMarkReady's
  // (already covered above), matching what qaIsReady actually reads
  // (state.seed/state.reviewed/state.componentOverrides - a real, already
  // client-cached shape, not a shortcut).
  for (const mailing of seed.mailings) {
    const base = mailingKey(mailing);
    Object.assign(sandbox.state.componentOverrides, {
      [`${base}::payment`]: "Active",
      [`${base}::envelope`]: "In Ashley Box",
      [`${base}::letter`]: "Stuffed",
      [`${base}::artifact`]: "Packed",
      [`${base}::insert`]: "Not Needed",
      [`${base}::location`]: "Ashley",
      [`${base}::qa`]: "Ready",
    });
  }

  const data = computeQaData(seed, {}, sandbox.state.reviewed, sandbox.state.componentOverrides, "all", "all", "", "2026-08-12", NO_LETTER_FOLDER);
  assert.ok(
    data.rows.every((row) => row.isReady),
    "fixture invariant: every row should be fully ready before onMarkMailed runs",
  );

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.qa onMarkMailed body exactly.
  data.rows.filter((row) => row.isReady).forEach((row) => sandbox.updateMailingStatus(row.mailing, "Mailed"));
  await waitForFetches();
  await flush();

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "mailingStatus"));
  assert.equal(rows.length, ROW_COUNT, "exactly one mailingStatus audit row per row actually changed");
  assert.ok(rows.every((row) => row.newValue === "Mailed"));

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false);
});

test("the staleness store's highest-wins handling survives out-of-order responses for a componentStatus write specifically (Queue's own e2e only proved this for mailingStatus)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();

  const spec1 = buildMailing(1);
  const spec2 = buildMailing(2);
  const seed = buildSeed([spec1, spec2]);
  await importSeed(POST, seed, "seed.xlsx");

  // Two real, sequential componentStatus writes - write 2 necessarily
  // produces a HIGHER marker than write 1, since audit_events' marker
  // only ever increases and write 2 commits strictly after write 1
  // completes.
  const response1 = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: componentKey(seed.mailings[0], "qa"), value: "Ready" })));
  const body1 = await response1.json();
  const response2 = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: componentKey(seed.mailings[1], "qa"), value: "Ready" })));
  const body2 = await response2.json();
  assert.ok(body2.marker > body1.marker, "fixture invariant: the second, later write should carry a strictly higher marker than the first");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  // Simulates the higher-marker response (write 2's) arriving and being
  // recorded FIRST, then the lower-marker response (write 1's) arriving
  // LATE - exactly the out-of-order case a slow request for an
  // earlier-issued write can produce in a real batch action, where every
  // field/row fires its own independent, unawaited POST.
  sandbox.staleness.recordOwnMarker(body2.marker);
  sandbox.staleness.recordOwnMarker(body1.marker);

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.myMarker, body2.marker, "a late-arriving LOWER marker must never regress myMarker backward from an already-recorded higher one");
  assert.equal(snapshot.stale, false);
});
