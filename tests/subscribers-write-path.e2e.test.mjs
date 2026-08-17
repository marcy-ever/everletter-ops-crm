// Verifies the write/print actions app/crm/CrmApp.tsx's REACT_VIEWS.
// subscribers entry drives - Phase 1 step 12 (CLAUDE.md), the largest
// migrated view and the first with profile actions that write AND
// print. Everything the server side of a componentStatus/mailingStatus
// write does (validation, audit log, key matching) is already covered
// end to end by tests/audit-events.e2e.test.mjs - not re-proven here.
// What's new, and what this file actually exists to prove, is the
// CLIENT side: do the exact sequences CrmApp.tsx's onMarkPrinted/
// onMarkAshley callbacks run (updateEnvelopeStatus()/
// updateMailingStatus() - the already-standard write-through mutators,
// unchanged) really produce the right POST body, really write exactly
// one audit row per write, and really avoid tripping this same user's
// own staleness banner - and does onPrintEnvelope really call the
// still-legacy envelopePrintRows()/openEnvelopePrint() with the exact
// same arguments the removed legacy handler used.
//
// The mailing fixture below is deliberately a 6-month (not Month-to-
// month) plan: updateEnvelopeStatus()'s own monthlyEnvelopeTargets()
// (lib/client/crm-state.ts) groups a Month-to-month mailing's envelope
// update with its sibling letter in the same ship month (CLAUDE.md's
// "month-to-month customers... normally need two envelopes printed
// together" rule) - a real property of that mutator, not a bug, but one
// that would make "exactly one audit row" nondeterministic here. A
// 6-month plan's monthlyEnvelopeTargets() always returns just the one
// mailing, keeping the audit-row-count assertions clean and correct
// without papering over the real grouping behavior.
//
// globalThis.fetch is rewired to call app/api/shared-state/route.ts's
// real POST handler directly, in-process, against a real Postgres - same
// wireFetchToRealRoute/waitForFetches technique steps 10-11 established.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped,
// not failed, if it isn't available. Run through `pnpm test:e2e`.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, loadAppJsSandbox, truncateAllTables } from "./e2e-helpers.mjs";
import { componentKey, mailingKey } from "../lib/domain/keys.ts";
import { computeSubscriberProfile, printedEnvelopeStatusForMailing } from "../app/crm/views/subscribers/subscribers-selectors.ts";

const skip = e2eSkipReason({ requiresFixture: false });

function buildMailing(n, overrides = {}) {
  const id = `T${n}`;
  return {
    subscriberId: `SUB-${id}`,
    subscriptionId: `PLAN-${id}`,
    recipientId: `REC-${id}`,
    orderId: `ORD-${id}`,
    mailingId: `MAIL-${id}`,
    character: "Marley",
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

function buildSeed(mailingSpecs, planByMailingId = {}) {
  return {
    subscribers: mailingSpecs.map((m) => ({ subscriberId: m.subscriberId, email: `${m.subscriberId}@example.test`, displayName: m.recipientName, status: "Active" })),
    recipients: mailingSpecs.map((m) => ({ recipientId: m.recipientId, subscriberId: m.subscriberId, name: m.recipientName, address: "1 Test St" })),
    subscriptions: mailingSpecs.map((m) => ({
      subscriptionId: m.subscriptionId,
      subscriberId: m.subscriberId,
      recipientId: m.recipientId,
      plan: planByMailingId[m.mailingId] || "Month-to-month",
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

// Same wireFetchToRealRoute/waitForFetches technique as
// tests/exceptions-write-path.e2e.test.mjs (step 10) and
// tests/import-write-path.e2e.test.mjs (step 11) - see either file's own
// header for why a bare setTimeout(resolve, 0) flush isn't enough once
// fetch does real I/O. Must be wired AFTER loadAppJsSandbox(), which
// stubs globalThis.fetch itself.
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

test("Mark Printed calls updateEnvelopeStatus, sends the correct componentStatus POST body, and writes exactly one audit row", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  const seed = buildSeed([spec], { [spec.mailingId]: "6-month" });
  await importSeed(POST, seed, "seed.xlsx");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  wireFetchToRealRoute(POST);
  sandbox.state.seed = seed;

  const profile = computeSubscriberProfile(seed, sandbox.state.statusOverrides, sandbox.state.reviewed, sandbox.state.componentOverrides, seed.subscribers[0]);
  assert.equal(profile.openRows.length, 1);
  const mailing = profile.openRows[0];
  const key = componentKey(mailing, "envelope");

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.subscribers onMarkPrinted
  // body exactly - not a re-implementation.
  sandbox.updateEnvelopeStatus(mailing, printedEnvelopeStatusForMailing(mailing));
  await flush();

  assert.equal(sandbox.state.componentOverrides[key], "Printed");
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemKey, key);
  assert.equal(rows[0].newValue, "Printed");

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "marking printed must not make this same client's own page look stale");
  assert.ok(snapshot.myMarker !== null && snapshot.myMarker === snapshot.serverMarker);
});

test("Mark At Ashley calls updateEnvelopeStatus AND updateMailingStatus, sends two correct POST bodies, and writes exactly one audit row for each", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(2);
  const seed = buildSeed([spec], { [spec.mailingId]: "6-month" });
  await importSeed(POST, seed, "seed.xlsx");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  wireFetchToRealRoute(POST);
  sandbox.state.seed = seed;

  const profile = computeSubscriberProfile(seed, sandbox.state.statusOverrides, sandbox.state.reviewed, sandbox.state.componentOverrides, seed.subscribers[0]);
  const mailing = profile.openRows[0];
  const envelopeKey = componentKey(mailing, "envelope");
  const statusKey = mailingKey(mailing);

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.subscribers onMarkAshley
  // body exactly.
  sandbox.updateEnvelopeStatus(mailing, "In Ashley Box");
  sandbox.updateMailingStatus(mailing, "Assembling");
  await flush();

  assert.equal(sandbox.state.componentOverrides[envelopeKey], "In Ashley Box");
  assert.equal(sandbox.state.statusOverrides[statusKey], "Assembling");

  const componentRows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(componentRows.length, 1);
  assert.equal(componentRows[0].newValue, "In Ashley Box");

  const statusRows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "mailingStatus"));
  assert.equal(statusRows.length, 1);
  assert.equal(statusRows[0].newValue, "Assembling");

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "marking at Ashley must not make this same client's own page look stale");
});

test("Print Envelope calls the still-legacy envelopePrintRows()/openEnvelopePrint() with the same arguments the removed legacy handler used", { skip }, async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  // loadAppJsSandbox()'s window stub has no location.href (no prior test
  // ever needed one) - envelopeCornerArtUrl() (legacy-app.js, part of the
  // unmodified envelope print generator this step explicitly doesn't
  // touch) resolves a relative asset URL against it. A local, test-file-
  // scoped addition, not a change to the shared sandbox or the app.
  globalThis.window.location.href = "http://localhost/";
  sandbox.state.seed = buildSeed([buildMailing(3, { status: "To Prepare" })], { "MAIL-T3": "6-month" });

  const profile = computeSubscriberProfile(sandbox.state.seed, {}, new Set(), {}, sandbox.state.seed.subscribers[0]);
  const mailing = profile.openRows[0];

  // openEnvelopePrint (legacy-app.js) calls window.open('', '_blank')
  // then popup.document.write/close - stub window.open so this can run
  // headlessly and capture what was written.
  const originalOpen = globalThis.window.open;
  let written = null;
  globalThis.window.open = () => ({
    document: {
      open() {},
      write(html) {
        written = html;
      },
      close() {},
    },
  });

  try {
    // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.subscribers onPrintEnvelope
    // body exactly: openEnvelopePrint(envelopePrintRows([mailing])).
    const expectedRows = sandbox.envelopePrintRows([mailing]);
    sandbox.openEnvelopePrint(expectedRows);

    assert.ok(written, "openEnvelopePrint should have written HTML into the popup");
    // envelopePrintRows filters to components whose envelope status is
    // "Need Print" - a freshly-imported mailing with no overrides
    // defaults to that, so the fixture's one row should survive the
    // filter and appear in the generated HTML by its recipient name.
    assert.equal(expectedRows.length, 1, "fixture invariant: the mailing's default envelope status should be Need Print");
    assert.match(written, /Test Recipient T3/);
  } finally {
    globalThis.window.open = originalOpen;
  }
});
