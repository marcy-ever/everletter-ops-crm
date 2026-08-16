// Verifies the "someone else changed something, refresh" staleness signal
// end to end against real Postgres and the real route handlers
// (app/api/change-marker/route.ts's GET, app/api/shared-state/route.ts's
// GET/POST) - not mocks. Covers the marker endpoint's own contract (current
// max, advances after a real write, doesn't advance on a soft-skip),
// GET /api/shared-state returning a marker consistent with what it
// returned, and - the core behavior this whole feature stands or falls on
// - two independently created lib/client/staleness.ts stores standing in
// for two real browser tabs sharing one server: one client's write making
// the OTHER client's page go stale, and a client's OWN write never making
// its OWN page go stale, including under a bulk action's out-of-order
// response arrival.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped, not
// failed, if it isn't available. Run through `pnpm test:e2e` (not `node
// --test` directly) - see docs/testing.md for why these files must be
// serialized.
import test from "node:test";
import assert from "node:assert/strict";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { mailingKey } from "../lib/domain/keys.ts";
import { createStalenessStore } from "../lib/client/staleness.ts";

const skip = e2eSkipReason({ requiresFixture: false });

// Same shape as tests/audit-events.e2e.test.mjs's own helpers - kept
// separate per this suite's established per-file convention (see
// tests/db-test-helpers.mjs's own comment).
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
      plan: "Month-to-month",
      character: m.character,
      startDate: "2026-01-01",
      endDate: "",
      activeState: "Active",
    })),
    orders: mailingSpecs.map((m) => ({ orderId: m.orderId, subscriberId: m.subscriberId, sourceOrderNumber: m.orderId, createdOn: "2026-01-01" })),
    mailings: mailingSpecs.map((m) => ({
      mailingId: m.mailingId,
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

function buildCrmDatasetBody(seed, sourceName = "test-fixture.xlsx") {
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

async function loadRoutes() {
  const sharedState = await import("../app/api/shared-state/route");
  const changeMarker = await import("../app/api/change-marker/route");
  return { POST: sharedState.POST, GET: sharedState.GET, pollGET: changeMarker.GET };
}

async function freshDb() {
  const { getDb } = await import("../db");
  const db = getDb();
  await truncateAllTables(db);
  const { auditEvents } = await import("../db/schema/audit_events");
  await db.delete(auditEvents);
  return db;
}

async function importSeed(POST, mailingSpecs, sourceName) {
  const response = await POST(postRequest(buildCrmDatasetBody(buildSeed(mailingSpecs), sourceName)));
  const body = await response.json().catch(() => null);
  assert.equal(response.status, 200, `seeding failed: ${JSON.stringify(body)}`);
  return body;
}

// --- the marker endpoint's own contract ---

test("GET /api/change-marker returns null when audit_events is empty, and advances after a real write", { skip }, async () => {
  const db = await freshDb();
  const { POST, pollGET } = await loadRoutes();
  const { auditEvents } = await import("../db/schema/audit_events");

  const before = await (await pollGET()).json();
  assert.equal(before.marker, null);

  await importSeed(POST, [buildMailing(1)], "seed.xlsx");

  const after = await (await pollGET()).json();
  assert.notEqual(after.marker, null);
  const [row] = await db.select().from(auditEvents);
  assert.equal(after.marker, row.id, "the endpoint's marker must be the real audit_events row's own id");
});

test("a soft-skipped write does not advance the marker", { skip }, async () => {
  await freshDb();
  const { POST, pollGET } = await loadRoutes();

  const before = await (await pollGET()).json();
  assert.equal(before.marker, null);

  const response = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: "MAIL-DOES-NOT-EXIST::999", value: "Mailed" })));
  assert.equal(response.status, 200, "a soft-skip still commits (200)");

  const after = await (await pollGET()).json();
  assert.equal(after.marker, null, "a write that changed nothing must not advance the marker");
});

test("GET /api/shared-state returns a marker consistent with the data it returned, and POST returns the post-write marker", { skip }, async () => {
  const db = await freshDb();
  const { POST, GET, pollGET } = await loadRoutes();

  const importBody = await importSeed(POST, [buildMailing(1)], "seed.xlsx");
  assert.equal(typeof importBody.marker, "number");

  const getBody = await (await GET()).json();
  assert.equal(getBody.marker, importBody.marker, "GET's own marker must agree with what the import's POST response already reported");

  const spec = buildMailing(1);
  const key = mailingKey({ mailingId: spec.mailingId, sourceRow: spec.sourceRow });
  const statusResponse = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key, value: "Mailed" })));
  const statusBody = await statusResponse.json();
  assert.ok(statusBody.marker > importBody.marker, "a real second change must produce a strictly higher marker");

  const pollBody = await (await pollGET()).json();
  assert.equal(pollBody.marker, statusBody.marker, "the dedicated poll endpoint must agree with the POST response that just wrote it");

  const { auditEvents } = await import("../db/schema/audit_events");
  const rows = await db.select().from(auditEvents);
  assert.equal(Math.max(...rows.map((r) => r.id)), statusBody.marker);
});

// --- the core behavior: two clients sharing one server ---

test("two clients: A loads, B writes elsewhere, A polls and goes stale", { skip }, async () => {
  const { POST, GET, pollGET } = await loadRoutes();
  await freshDb();
  await importSeed(POST, [buildMailing(1), buildMailing(2)], "seed.xlsx");

  // Client A loads the page.
  const aLoad = await (await GET()).json();
  const stalenessA = createStalenessStore();
  stalenessA.recordOwnMarker(aLoad.marker);
  assert.equal(stalenessA.getSnapshot().stale, false, "immediately after its own load, A must not be stale");

  // Client B (a separate tab/session) changes a mailing's status - A never
  // sees this response at all, matching a real second browser tab.
  const specB = buildMailing(2);
  const keyB = mailingKey({ mailingId: specB.mailingId, sourceRow: specB.sourceRow });
  await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: keyB, value: "Mailed" })));

  // A's poll picks up B's change.
  const aPoll = await (await pollGET()).json();
  stalenessA.recordServerMarker(aPoll.marker);

  assert.equal(stalenessA.getSnapshot().stale, true, "A must go stale once B's change is visible to a poll");
});

test("two clients (the inverse): A loads, A writes, A polls and stays current", { skip }, async () => {
  const { POST, GET, pollGET } = await loadRoutes();
  await freshDb();
  await importSeed(POST, [buildMailing(1)], "seed.xlsx");

  const aLoad = await (await GET()).json();
  const stalenessA = createStalenessStore();
  stalenessA.recordOwnMarker(aLoad.marker);

  // A makes its own change - mirrors exactly what
  // lib/client/shared-state-client.ts's saveSharedState does on a
  // successful response: record the marker the write's own response
  // returned, immediately, not waiting for a poll.
  const specA = buildMailing(1);
  const keyA = mailingKey({ mailingId: specA.mailingId, sourceRow: specA.sourceRow });
  const aSaveResponse = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: keyA, value: "Mailed" })));
  const aSaveBody = await aSaveResponse.json();
  stalenessA.recordOwnMarker(aSaveBody.marker);

  // A polls afterward, same as it would 45s later in the real app.
  const aPoll = await (await pollGET()).json();
  stalenessA.recordServerMarker(aPoll.marker);

  assert.equal(
    stalenessA.getSnapshot().stale,
    false,
    "A's own change, followed by A's own poll, must never make A's own page look stale - this is the case that determines whether anyone keeps trusting the banner",
  );
});

test("bulk action: many of A's own saves, applied in a shuffled (out-of-order) sequence, never go stale", { skip }, async () => {
  const { POST, GET, pollGET } = await loadRoutes();
  await freshDb();
  const specs = Array.from({ length: 10 }, (_, i) => buildMailing(i + 1));
  await importSeed(POST, specs, "seed.xlsx");

  const aLoad = await (await GET()).json();
  const stalenessA = createStalenessStore();
  stalenessA.recordOwnMarker(aLoad.marker);

  // Real, sequential POSTs (this route serializes writes through one
  // transaction each) - each produces a strictly increasing marker in the
  // real audit_events table. The out-of-order part being tested is the
  // CLIENT's handling of the responses, not the server's write order - see
  // lib/client/staleness.ts's own comment on why recordOwnMarker keeps the
  // highest seen rather than the most recent, which is exactly what a
  // bulk action's real, out-of-order response arrival needs.
  const markers = [];
  for (const spec of specs) {
    const key = mailingKey({ mailingId: spec.mailingId, sourceRow: spec.sourceRow });
    const response = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key, value: "Mailed" })));
    const body = await response.json();
    markers.push(body.marker);
  }
  assert.equal(new Set(markers).size, markers.length, "each real write must have produced a distinct marker");

  // Apply the real markers to the store in a deliberately shuffled order,
  // simulating responses arriving out of order over the network.
  const shuffled = [...markers].reverse();
  shuffled.splice(2, 0, shuffled.pop());
  for (const marker of shuffled) {
    stalenessA.recordOwnMarker(marker);
  }
  assert.equal(stalenessA.getSnapshot().myMarker, Math.max(...markers), "out-of-order application must still settle on the highest real marker");
  assert.equal(stalenessA.getSnapshot().stale, false, "a bulk action's out-of-order responses must never leave the page falsely stale");

  const aPoll = await (await pollGET()).json();
  stalenessA.recordServerMarker(aPoll.marker);
  assert.equal(stalenessA.getSnapshot().stale, false, "still current after polling, since nothing but A's own writes happened");
});
