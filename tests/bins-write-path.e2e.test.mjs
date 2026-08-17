// Verifies the write paths app/crm/CrmApp.tsx's REACT_VIEWS.bins entry
// drives - Phase 1 step 16 (CLAUDE.md): per-row [data-bin-select] writes
// (the REFERENCE implementation this migration's whole mobile-select
// mechanism is built on - see tests/packet-bins-select-parity.test.mjs
// for the cross-view proof that Batch Packet's mobile cards, wired in
// this same step's second commit, write the identical key/value shape)
// and two bulk-mark buttons, each firing three updateComponentStatus
// calls per shown row, migrated exactly as they are (no confirmation, no
// batching, no undo - Marcy's decision to make, not this branch's).
//
// Everything the server side of a componentStatus write does (validation,
// audit log, key matching) is already covered end to end by
// tests/audit-events.e2e.test.mjs - not re-proven here. What this file
// exists to prove:
//  1. each of the three per-row fields writes through the correct path
//     (plain updateComponentStatus, no envelope fan-out) and produces
//     exactly one audit row, with no self-inflicted staleness banner.
//  2. both bulk-mark modes, at scale: three writes per row each (not one),
//     the correct target values per mode, and no self-inflicted staleness.
//  3. a bulk action where every write fails collapses into ONE counted
//     failure message, not one per field per row.
//  4. the staleness store's highest-wins property holds for this view's
//     own componentStatus writes specifically.
//
// globalThis.fetch is rewired to call app/api/shared-state/route.ts's
// real POST handler directly, in-process, against a real Postgres - same
// wireFetchToRealRoute/waitForFetches technique steps 10-15 established.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped,
// not failed, if it isn't available. Run through `pnpm test:e2e`.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { createAppState } from "../app/crm/shell/crm-app-state.ts";
import { formatSaveFailureBannerHtml } from "../app/crm/shell/banners.ts";
import { installLocalStorageStub } from "./shell-test-helpers.mjs";
import { componentKey } from "../lib/domain/keys.ts";

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
    plan: "12-month",
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

// Same wireFetchToRealRoute/waitForFetches technique as steps 10-15's own
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

// Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.bins onBulkMark body exactly.
function fireBulkMark(appState, mailings, mode) {
  mailings.forEach((mailing) => {
    if (mode === "ready") {
      appState.updateComponentStatus(mailing, "envelope", "In Ashley Box");
      appState.updateComponentStatus(mailing, "letter", "Stuffed");
      appState.updateComponentStatus(mailing, "location", "Ashley");
    } else {
      appState.updateComponentStatus(mailing, "envelope", "Need Print");
      appState.updateComponentStatus(mailing, "letter", "Need Print");
      appState.updateComponentStatus(mailing, "location", "Marcy");
    }
  });
}

test("each of the three per-row fields, changed individually, sends the correct POST, writes exactly one audit row, and doesn't trip this user's own staleness banner", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  const seed = buildSeed([spec]);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const appState = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);
  const mailing = seed.mailings[0];

  const fields = [
    ["envelope", "Printed"],
    ["letter", "Printed"],
    ["location", "Batch Bin"],
  ];

  for (const [field, newValue] of fields) {
    appState.updateComponentStatus(mailing, field, newValue);
    await waitForFetches();
    await flush();

    const key = componentKey(mailing, field);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.itemKey, key));
    assert.equal(rows.length, 1, `field "${field}" should have produced exactly one audit row`);
    assert.equal(rows[0].kind, "componentStatus");
    assert.equal(rows[0].newValue, newValue);

    const snapshot = appState.staleness.getSnapshot();
    assert.equal(snapshot.stale, false, `changing field "${field}" must not make this same client's own page look stale`);
  }
});

test("onBulkMark('ready') at scale writes exactly three audit rows per row - one per field, with the correct target values", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const ROW_COUNT = 10;
  const specs = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  const seed = buildSeed(specs);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const appState = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);

  fireBulkMark(appState, seed.mailings, "ready");
  await waitForFetches();
  await flush();

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(rows.length, ROW_COUNT * 3, "exactly three audit rows per row - envelope, letter, location");

  const byField = {};
  for (const row of rows) {
    const field = row.itemKey.split("::")[2];
    byField[field] = (byField[field] || new Set()).add(row.newValue);
  }
  assert.deepEqual(Array.from(byField.envelope), ["In Ashley Box"]);
  assert.deepEqual(Array.from(byField.letter), ["Stuffed"]);
  assert.deepEqual(Array.from(byField.location), ["Ashley"]);

  const snapshot = appState.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "the actor's own bulk action must not make their own page look stale either");
});

test("onBulkMark('check') at scale writes the opposite target values - the second mode, not just the first", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const ROW_COUNT = 8;
  const specs = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  const seed = buildSeed(specs);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const appState = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);

  fireBulkMark(appState, seed.mailings, "check");
  await waitForFetches();
  await flush();

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(rows.length, ROW_COUNT * 3);

  const byField = {};
  for (const row of rows) {
    const field = row.itemKey.split("::")[2];
    byField[field] = (byField[field] || new Set()).add(row.newValue);
  }
  assert.deepEqual(Array.from(byField.envelope), ["Need Print"]);
  assert.deepEqual(Array.from(byField.letter), ["Need Print"]);
  assert.deepEqual(Array.from(byField.location), ["Marcy"]);
});

test("a bulk-mark action where every write fails collapses into ONE counted failure message, not one per field per row", { skip }, async () => {
  await freshDb();
  installLocalStorageStub();
  const appState = createAppState();
  // A genuine network failure (fetch rejects), same shape a dropped
  // connection mid-bulk-action would produce.
  globalThis.fetch = () => Promise.reject(new Error("simulated network failure"));

  const ROW_COUNT = 6;
  const mailings = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  fireBulkMark(appState, mailings, "ready");
  await flush();

  const EXPECTED_FAILURES = ROW_COUNT * 3;
  const snapshot = appState.saveFailures.getSnapshot();
  assert.equal(snapshot.failedSaveCount, EXPECTED_FAILURES);

  const html = formatSaveFailureBannerHtml(appState.saveFailures.getSnapshot());
  assert.match(html, new RegExp(`${EXPECTED_FAILURES} changes couldn.{1,8}t be saved`));
  assert.equal((html.match(/<p>/g) || []).length, 1);
});

test("the staleness store's highest-wins handling survives out-of-order responses for this view's own componentStatus writes", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();

  const spec1 = buildMailing(1);
  const spec2 = buildMailing(2);
  const seed = buildSeed([spec1, spec2]);
  await importSeed(POST, seed, "seed.xlsx");

  const response1 = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: componentKey(seed.mailings[0], "location"), value: "Ashley" })));
  const body1 = await response1.json();
  const response2 = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: componentKey(seed.mailings[1], "location"), value: "Ashley" })));
  const body2 = await response2.json();
  assert.ok(body2.marker > body1.marker, "fixture invariant: the second, later write should carry a strictly higher marker than the first");

  installLocalStorageStub();
  const appState = createAppState();
  appState.staleness.recordOwnMarker(body2.marker);
  appState.staleness.recordOwnMarker(body1.marker);

  const snapshot = appState.staleness.getSnapshot();
  assert.equal(snapshot.myMarker, body2.marker, "a late-arriving LOWER marker must never regress myMarker backward from an already-recorded higher one");
  assert.equal(snapshot.stale, false);
});
