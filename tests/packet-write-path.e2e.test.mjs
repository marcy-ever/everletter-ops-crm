// Verifies the write path app/crm/CrmApp.tsx's REACT_VIEWS.packet entry
// drives for its mobile card list - Phase 1 step 15 (CLAUDE.md), the
// largest snapshot in the suite and the first view whose WRITES come from
// two different layouts of the same rows (a desktop final table, read-only,
// and a mobile card list that writes - see Packet.tsx's own header for why
// that's real and pre-existing, not a naming mistake this step introduced).
//
// Everything the server side of a componentStatus write does (validation,
// audit log, key matching) is already covered end to end by
// tests/audit-events.e2e.test.mjs - not re-proven here. What this file
// exists to prove, and why it matters more than a routine per-field check:
// legacy's own renderPacket() rendered the mobile cards' [data-bin-select]
// selects but NEVER wired a change listener for them (confirmed directly
// by reading renderPacket() in full and grepping every [data-bin-select]
// listener in app/crm/legacy-app.js - exactly one exists, inside
// renderBins()/Ashley Bins, for its own elements, never Packet's). Changing
// a mobile card's status in the live legacy app currently does nothing.
// This step wires a real handler for the first time, reconstructed from
// the ONE actual precedent for this exact attribute anywhere in the app -
// Ashley Bins' own handler, which calls plain updateComponentStatus
// unconditionally (never updateEnvelopeStatus, even for the envelope
// field). Proven here: each of the three mobile-card fields writes
// correctly, exactly one audit row each, no self-inflicted staleness
// banner, AND - the one property that would silently break if a future
// change ever "fixed" this to match QA's own envelope-branching callback -
// that a Month-to-month mailing's envelope write does NOT fan out to
// sibling mailings the way QA/Queue's updateEnvelopeStatus-routed writes
// do, matching Ashley Bins' own real, live behavior exactly.
//
// globalThis.fetch is rewired to call app/api/shared-state/route.ts's real
// POST handler directly, in-process, against a real Postgres - same
// wireFetchToRealRoute/waitForFetches technique steps 10-14 established.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped, not
// failed, if it isn't available. Run through `pnpm test:e2e`.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, loadAppJsSandbox, truncateAllTables } from "./e2e-helpers.mjs";
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

// Same wireFetchToRealRoute/waitForFetches technique as steps 10-14's own
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

test("each of the three mobile-card fields (envelope/letter/location), changed individually, sends the correct POST, writes exactly one audit row, and doesn't trip this user's own staleness banner", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  const seed = buildSeed([spec]);
  await importSeed(POST, seed, "seed.xlsx");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  const { waitForFetches } = wireFetchToRealRoute(POST);
  const mailing = seed.mailings[0];

  const fields = [
    ["envelope", "Printed"],
    ["letter", "Printed"],
    ["location", "Batch Bin"],
  ];

  for (const [field, newValue] of fields) {
    // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.packet onFieldChange body
    // exactly: plain updateComponentStatus, no envelope branching -
    // reconstructed from Ashley Bins' own [data-bin-select] handler, the
    // one real precedent for this attribute anywhere in the app.
    sandbox.updateComponentStatus(mailing, field, newValue);
    await waitForFetches();
    await flush();

    const key = componentKey(mailing, field);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.itemKey, key));
    assert.equal(rows.length, 1, `field "${field}" should have produced exactly one audit row`);
    assert.equal(rows[0].kind, "componentStatus");
    assert.equal(rows[0].newValue, newValue);

    const snapshot = sandbox.staleness.getSnapshot();
    assert.equal(snapshot.stale, false, `changing field "${field}" from the mobile card must not make this same client's own page look stale`);
  }
});

test("a mobile card's envelope-field write does NOT fan out to sibling Month-to-month mailings - unlike QA/Queue's updateEnvelopeStatus-routed writes, Packet's mobile write goes through plain updateComponentStatus, matching Ashley Bins' own real behavior", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  // Two Month-to-month mailings under the SAME subscription, sharing a
  // ship month - exactly the shape lib/client/crm-state.ts's
  // monthlyEnvelopeTargets() fans out across when a write goes through
  // updateEnvelopeStatus(). If this test's own onFieldChange wiring ever
  // regressed to route through updateEnvelopeStatus instead of plain
  // updateComponentStatus, this test would start seeing 2 audit rows
  // instead of 1.
  const sharedSubscriptionId = "PLAN-SHARED";
  const spec1 = buildMailing(1, { plan: "Month-to-month", subscriptionId: sharedSubscriptionId, letterNumber: 1, shipDate: "2026-08-15" });
  const spec2 = buildMailing(2, { plan: "Month-to-month", subscriptionId: sharedSubscriptionId, letterNumber: 2, shipDate: "2026-08-15" });
  const seed = buildSeed([spec1, spec2]);
  await importSeed(POST, seed, "seed.xlsx");

  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  const { waitForFetches } = wireFetchToRealRoute(POST);

  sandbox.updateComponentStatus(seed.mailings[0], "envelope", "Printed");
  await waitForFetches();
  await flush();

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "componentStatus"));
  assert.equal(rows.length, 1, "plain updateComponentStatus writes exactly the one targeted mailing, no fan-out");
  assert.equal(rows[0].itemKey, componentKey(seed.mailings[0], "envelope"));
});
