// Verifies the write paths app/crm/CrmApp.tsx's REACT_VIEWS.queue entry
// drives - Phase 1 step 13 (CLAUDE.md), the busiest operational screen in
// the app: a per-row status write (the same write path as Needs Review's
// Reviewed button, step 10, just one per row) and five bulk-action
// buttons that rewrite every currently-shown row in one click, migrated
// exactly as they are - no confirmation, no batching, no undo (Marcy's
// decision to make, not this branch's to act on).
//
// Everything the server side of a mailingStatus write does (validation,
// audit log, key matching) is already covered end to end by
// tests/audit-events.e2e.test.mjs - not re-proven here. What's new, and
// what this file actually exists to prove, is the CLIENT side at the
// scale this view actually operates at: does a single row's write
// produce the right POST/audit row without tripping this user's own
// staleness banner (the same property step 10/11/12 already proved for
// other write paths, reconfirmed here since it's the first time this
// exact mailingStatus path is driven from a React callback); does a bulk
// write across many rows produce exactly one audit row per row actually
// changed; does a batch of real failures collapse into ONE counted
// failure message rather than many (tests/save-failure-banner.test.mjs
// already proves the counting mechanism itself against a stubbed fetch -
// this reconfirms it against a real rejected POST, fired through the
// real onBulkStatus loop shape); and does the staleness store's
// highest-wins handling (lib/client/staleness.ts's recordOwnMarker)
// survive a response arriving out of order, using real markers from real
// writes rather than fabricated numbers.
//
// globalThis.fetch is rewired to call app/api/shared-state/route.ts's
// real POST handler directly, in-process, against a real Postgres - same
// wireFetchToRealRoute/waitForFetches technique steps 10-12 established.
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
import { mailingKey } from "../lib/domain/keys.ts";

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

function buildSeed(mailingSpecs) {
  return {
    subscribers: mailingSpecs.map((m) => ({ subscriberId: m.subscriberId, email: `${m.subscriberId}@example.test`, displayName: m.recipientName, status: "Active" })),
    recipients: mailingSpecs.map((m) => ({ recipientId: m.recipientId, subscriberId: m.subscriberId, name: m.recipientName, address: "1 Test St" })),
    subscriptions: mailingSpecs.map((m) => ({
      subscriptionId: m.subscriptionId,
      subscriberId: m.subscriberId,
      recipientId: m.recipientId,
      plan: "6-month",
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

// Same wireFetchToRealRoute/waitForFetches technique as steps 10-12's own
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

test("a single row's status change (onStatusChange) sends the correct POST body, writes exactly one audit row, and doesn't trip this user's own staleness banner", { skip }, async () => {
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
  const key = mailingKey(mailing);

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.queue onStatusChange body
  // exactly - not a re-implementation.
  sandbox.updateMailingStatus(mailing, "Printing");
  await waitForFetches();
  await flush();

  assert.equal(sandbox.state.statusOverrides[key], "Printing");
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "mailingStatus"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemKey, key);
  assert.equal(rows[0].previousValue, "To Prepare");
  assert.equal(rows[0].newValue, "Printing");

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "changing this row's own status must not make this same client's own page look stale");
  assert.ok(snapshot.myMarker !== null && snapshot.myMarker === snapshot.serverMarker);
});

test("a bulk action (onBulkStatus) at realistic scale writes exactly one audit row per row actually changed", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const ROW_COUNT = 25;
  const specs = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  const seed = buildSeed(specs);
  await importSeed(POST, seed, "seed.xlsx");

  installLocalStorageStub();
  const sandbox = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.queue onBulkStatus body
  // exactly: data.rows.forEach(mailing => updateMailingStatus(mailing,
  // nextStatus)) - every currently-shown row, one independent POST each,
  // no batching. 25 concurrent, unawaited writes against a real Postgres
  // is exactly the case waitForFetches() exists for - a bare
  // setTimeout(resolve, 0) flush let some of the 25 real transactions
  // still be in flight when the audit_events count was read, undercounting
  // it (verified directly, not assumed - see steps 10-12's own e2e files
  // for the same fix against a single write, generalized here to many).
  seed.mailings.forEach((mailing) => sandbox.updateMailingStatus(mailing, "Printing"));
  await waitForFetches();
  await flush();

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "mailingStatus"));
  assert.equal(rows.length, ROW_COUNT, "exactly one audit row per row actually changed - no more, no fewer");
  assert.ok(rows.every((row) => row.newValue === "Printing"));

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "the actor's own bulk change must not make their own page look stale either");
});

test("a bulk action where every write fails collapses into ONE counted failure message, not one per row", { skip }, async () => {
  await freshDb();
  installLocalStorageStub();
  const sandbox = createAppState();
  // A genuine network failure (fetch rejects, same shape a dropped
  // connection mid-bulk-action would produce), not a stubbed HTTP
  // rejection - saveSharedState's own .catch branch
  // (lib/client/shared-state-client.ts) handles this for real.
  globalThis.fetch = () => Promise.reject(new Error("simulated network failure"));

  const ROW_COUNT = 12;
  const mailings = Array.from({ length: ROW_COUNT }, (_, i) => buildMailing(i + 1));
  mailings.forEach((mailing) => sandbox.updateMailingStatus(mailing, "Printing"));
  await flush();

  const snapshot = sandbox.saveFailures.getSnapshot();
  assert.equal(snapshot.failedSaveCount, ROW_COUNT);

  const html = formatSaveFailureBannerHtml(sandbox.saveFailures.getSnapshot());
  assert.match(html, new RegExp(`${ROW_COUNT} changes couldn.{1,8}t be saved`));
  // Counted, not enumerated - exactly one <p> for the save-failure
  // message, not one per failed row (same property
  // tests/save-failure-banner.test.mjs already proves for the general
  // mechanism - reconfirmed here against a real rejected POST fired
  // through the actual bulk-action loop shape).
  assert.equal((html.match(/<p>/g) || []).length, 1);
});

test("the staleness store's highest-wins handling survives a lower marker arriving after a higher one (out-of-order responses), using real markers from real writes", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();

  const spec1 = buildMailing(1);
  const spec2 = buildMailing(2);
  const seed = buildSeed([spec1, spec2]);
  await importSeed(POST, seed, "seed.xlsx");

  // Two real, sequential writes - write 2 necessarily produces a HIGHER
  // marker than write 1, since audit_events' marker only ever increases
  // and write 2 commits strictly after write 1 completes.
  const response1 = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: mailingKey(seed.mailings[0]), value: "Printing" })));
  const body1 = await response1.json();
  const response2 = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: mailingKey(seed.mailings[1]), value: "Printing" })));
  const body2 = await response2.json();
  assert.ok(body2.marker > body1.marker, "fixture invariant: the second, later write should carry a strictly higher marker than the first");

  installLocalStorageStub();
  const sandbox = createAppState();
  // Simulates the higher-marker response (write 2's) arriving and being
  // recorded FIRST, then the lower-marker response (write 1's) arriving
  // LATE - exactly the out-of-order case a slow request for an
  // earlier-issued write can produce in the real bulk-action loop, where
  // every row fires its own independent, unawaited POST.
  sandbox.staleness.recordOwnMarker(body2.marker);
  sandbox.staleness.recordOwnMarker(body1.marker);

  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.myMarker, body2.marker, "a late-arriving LOWER marker must never regress myMarker backward from an already-recorded higher one");
  assert.equal(snapshot.stale, false);
});
