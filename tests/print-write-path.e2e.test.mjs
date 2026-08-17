// Verifies the write paths app/crm/CrmApp.tsx's REACT_VIEWS.print entry
// drives - Phase 1 step 17 (CLAUDE.md), the twelfth and last view migrated.
// Batch Print's own generator (envelopeHtml() et al.) never touches the
// server at all - see app/crm/views/envelope-print/envelope-html.ts's own
// header and tests/envelope-html-golden.test.mjs for that half's (byte-
// identical, not this file's normalized) coverage. What's left, and what
// this file exists to prove, is everything that DOES write:
//  1. the per-row status select writes through updateMailingStatus - one
//     audit row, no self-inflicted staleness banner (same shape Production
//     Queue's own single-field write proved, reconfirmed here since Print
//     is a second, independent call site of the same onFieldChange pattern).
//  2. the per-row envelope-status select writes through
//     updateEnvelopeStatus specifically, not updateComponentStatus - the
//     one field this view's onFieldChange branches on (see CrmApp.tsx's
//     REACT_VIEWS.print entry).
//  3. onMarkEnvelopesPrinted's bulk loop, at scale: exactly one audit row
//     per row shown (not per envelope unit - envelopeQuantity only affects
//     the VALUE written, "Printed" vs "Both Printed", via
//     qaPrintedEnvelopeStatusForMailing - reused from qa-selectors.ts, not
//     reimplemented, per that module's own updated header), and the
//     staleness store's own-write immunity holds for it too.
//  4. computePrintData's own filter chain (Need-Print membership, scope,
//     stock) against a REAL imported/reconstructed dataset (GET's own
//     buildDatasetFromTables/build-overrides-from-tables round trip), not
//     just hand-built fixture objects - the same "real dataset" treatment
//     step 14's (QA) own e2e file gave its own default-status gap.
//
// globalThis.fetch is rewired to call app/api/shared-state/route.ts's real
// POST/GET handlers directly, in-process, against a real Postgres - same
// wireFetchToRealRoute/waitForFetches technique steps 10-16 established.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped, not
// failed, if it isn't available. Run through `pnpm test:e2e`.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { createAppState } from "../app/crm/shell/crm-app-state.ts";
import { installLocalStorageStub } from "./shell-test-helpers.mjs";
import { componentKey, mailingKey } from "../lib/domain/keys.ts";
import { printedEnvelopeStatusForMailing as qaPrintedEnvelopeStatusForMailing } from "../app/crm/views/qa/qa-selectors.ts";
import { computePrintData } from "../app/crm/views/envelope-print/print-selectors.ts";

const skip = e2eSkipReason({ requiresFixture: false });
const EMPTY_DRIVE_CONFIG = { printReadyFolderUrl: "", characterFolders: {}, envelopeFolders: {}, letterFolders: {} };

// plan "Month-to-month" - the one plan whose own default envelope status
// (lib/client/selectors.ts's defaultComponentStatus) is "Need Print" with
// zero overrides (printModeForPlan isn't "Prepaid bulk" for it), so these
// rows land inside computePrintData's own baseRows filter without any
// setup write first - the same real, not-a-test-shortcut fact
// tests/print-selectors.test.mjs's own mailing() factory documents.
function buildMailing(n, overrides = {}) {
  const id = `T${n}`;
  return {
    subscriberId: `SUB-${id}`,
    subscriptionId: `PLAN-${id}`,
    recipientId: `REC-${id}`,
    orderId: `ORD-${id}`,
    mailingId: `MAIL-${id}`,
    character: "Marley",
    plan: "Month-to-month",
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

// Same wireFetchToRealRoute/waitForFetches technique as steps 10-16's own
// e2e write-path files - see any of their headers for why a bare
// setTimeout(resolve, 0) flush isn't enough once fetch does real I/O.
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

test("the per-row status select writes through updateMailingStatus - one audit row, no self-inflicted staleness banner", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  const seed = buildSeed([spec]);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const sandbox = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);
  const mailing = seed.mailings[0];

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.print onFieldChange body for
  // field === "status" exactly.
  sandbox.updateMailingStatus(mailing, "Printing");
  await waitForFetches();
  await flush();

  const key = mailingKey(mailing);
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.itemKey, key));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "mailingStatus");
  assert.equal(rows[0].newValue, "Printing");

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "changing this row's own status must not make this same client's own page look stale");
});

test("the per-row envelope-status select writes through updateEnvelopeStatus specifically - one audit row keyed to the envelope field", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  const seed = buildSeed([spec]);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const sandbox = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);
  const mailing = seed.mailings[0];

  // updateEnvelopeStatus's own monthlyEnvelopeTargets (lib/client/crm-state.ts)
  // reads state.seed whenever the mailing's plan is "Month-to-month" (to
  // fan out to every sibling mailing sharing the same subscription/month) -
  // real state CrmApp.tsx always has populated by this point (its
  // REACT_VIEWS.print entry starts with `if (!state.seed) return null`),
  // so this mirrors that real precondition rather than working around it.
  sandbox.state.seed = seed;

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.print onFieldChange body for
  // field === "envelope" exactly - the one branch this view's onFieldChange
  // takes that Production Queue's own (status-only) never needs to.
  sandbox.updateEnvelopeStatus(mailing, "Printed");
  await waitForFetches();
  await flush();

  const key = componentKey(mailing, "envelope");
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.itemKey, key));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "componentStatus");
  assert.equal(rows[0].newValue, "Printed");

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false);
});

test("onMarkEnvelopesPrinted at scale writes exactly one audit row per shown row, with the value driven by envelopeQuantity (Month-to-month rows get 'Both Printed', not 'Printed')", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const ROW_COUNT = 10;
  // Every plan here is Month-to-month, so envelopeQuantityForMailing is 2
  // for every row (lib/domain/plans.ts) - deliberately, so this test can
  // assert the bulk action's value ("Both Printed") isn't a hardcoded
  // "Printed" that happened to look right for a 1-envelope row.
  const specs = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  const seed = buildSeed(specs);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const sandbox = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);
  // See the single-row envelope-write test above for why this is required
  // for a Month-to-month mailing specifically.
  sandbox.state.seed = seed;

  const data = computePrintData(seed, {}, new Set(), {}, "all", "all", "all", "", "2026-08-12", EMPTY_DRIVE_CONFIG);
  assert.equal(data.rows.length, ROW_COUNT, "fixture invariant: every row should be shown by default (Month-to-month defaults to Need Print)");

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.print onMarkEnvelopesPrinted
  // body exactly - not a re-implementation.
  data.rows.forEach((row) => sandbox.updateEnvelopeStatus(row.mailing, qaPrintedEnvelopeStatusForMailing(row)));
  await waitForFetches();
  await flush();

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(rows.length, ROW_COUNT, "exactly one audit row per row shown, not one per envelope unit");
  assert.ok(rows.every((row) => row.newValue === "Both Printed"), "every row here has envelopeQuantity 2 (Month-to-month), so every write should be 'Both Printed'");

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "the actor's own batch action must not make their own page look stale either");
});

test("onMarkEnvelopesPrinted writes 'Printed' (not 'Both Printed') for a non-Month-to-month row with envelopeQuantity 1", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  // plan "One-time": not "Month-to-month" (envelopeQuantity 1, not 2) and
  // not "6-month"/"12-month" either (printModeForPlan falls through to
  // "Special", so isPrepaid is false and the envelope default is still
  // "Need Print", the same real distinction tests/qa-write-path.e2e.test.mjs's
  // own buildMailing() header documents).
  const spec = buildMailing(1, { plan: "One-time" });
  const seed = buildSeed([spec]);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const sandbox = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);

  const data = computePrintData(seed, {}, new Set(), {}, "all", "all", "all", "", "2026-08-12", EMPTY_DRIVE_CONFIG);
  assert.equal(data.rows.length, 1, "fixture invariant: the one-time row should be shown by default");
  assert.equal(data.rows[0].envelopeQuantity, 1);

  data.rows.forEach((row) => sandbox.updateEnvelopeStatus(row.mailing, qaPrintedEnvelopeStatusForMailing(row)));
  await waitForFetches();
  await flush();

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].newValue, "Printed");
});

test("computePrintData's Need-Print membership, scope, and stock filters hold against a REAL imported and reconstructed dataset (GET's own buildDatasetFromTables round trip), not just hand-built fixture objects", { skip }, async () => {
  const { POST, GET } = await loadRoute();
  await freshDb();

  const monthly = buildMailing(1, { character: "Ringo", plan: "Month-to-month" });
  const prepaid = buildMailing(2, { character: "Ringo", plan: "12-month" });
  const otherStock = buildMailing(3, { character: "Harper", plan: "Month-to-month" });
  const seed = buildSeed([monthly, prepaid, otherStock]);
  await importSeed(POST, seed, "seed.xlsx");

  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  const reviewed = new Set(body.reviewed);

  const all = computePrintData(body.dataset, {}, reviewed, body.componentOverrides, "all", "all", "all", "", "2026-08-12", EMPTY_DRIVE_CONFIG);
  // The prepaid (12-month) row defaults to "In Ashley Box" against the
  // REAL reconstructed dataset too - it never reaches baseRows without an
  // explicit status change, the same real business rule
  // tests/print-selectors.test.mjs's unit coverage already pins, now
  // reconfirmed end to end.
  assert.deepEqual(
    all.rows.map((row) => row.mailing.mailingId).sort(),
    [monthly.mailingId, otherStock.mailingId].sort(),
  );

  // "monthly" scope is a no-op here (both surviving rows are already
  // Month-to-month) - proven separately by print-selectors.test.mjs's own
  // dedicated scope test with a real prepaid-vs-monthly contrast; what
  // this reconfirms is that the scope filter still composes correctly
  // (doesn't drop a row it shouldn't) against a real reconstructed dataset.
  const scoped = computePrintData(body.dataset, {}, reviewed, body.componentOverrides, "all", "monthly", "all", "", "2026-08-12", EMPTY_DRIVE_CONFIG);
  assert.deepEqual(
    scoped.rows.map((row) => row.mailing.mailingId).sort(),
    [monthly.mailingId, otherStock.mailingId].sort(),
  );

  const ringoStock = all.envelopeGroups.find((group) => group.label.startsWith("Ringo"));
  assert.ok(ringoStock, "fixture invariant: a Ringo stock group should exist");
  const stockFiltered = computePrintData(body.dataset, {}, reviewed, body.componentOverrides, "all", "all", ringoStock.label, "", "2026-08-12", EMPTY_DRIVE_CONFIG);
  assert.deepEqual(
    stockFiltered.rows.map((row) => row.mailing.mailingId),
    [monthly.mailingId],
  );
});
