// Verifies the audit log end to end against a real Postgres and the real
// route handlers (app/api/shared-state/route.ts's POST, app/api/audit/
// route.ts's GET) - not mocks. Covers: one audit_events row per real change
// (mailingStatus/componentStatus/reviewedException/crmDataset) with the
// right previous/new values, no row for a soft-skipped write, transactional
// atomicity with the table write it accompanies, actor capture (this
// harness's own no-session case - see NO_SESSION_ACTOR below), the
// exceptions 4-segment key matching this task closes the gap on, and the
// read endpoint's ordering/limit.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped, not
// failed, if it isn't available. Run through `pnpm test:e2e` (not `node
// --test` directly) - see docs/testing.md for why these files must be
// serialized.
import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { e2eSkipReason, loadAppJsSandbox, loadSpreadsheetRows, truncateAllTables } from "./e2e-helpers.mjs";
import { countRows } from "./db-test-helpers.mjs";
import { exceptionReviewKey, mailingKey, componentKey } from "../lib/domain/keys.ts";

const skip = e2eSkipReason({ requiresFixture: false });
const skipRequiresFixture = e2eSkipReason();

// Same shape tests/shared-state-validation.e2e.test.mjs's own buildMailing/
// buildSeed use - kept separate rather than shared, per this suite's
// established convention (see tests/db-test-helpers.mjs's own comment on
// why per-file business helpers stay duplicated while only the env/sandbox
// preamble is centralized). Extended here with exceptions support, which
// that file's version doesn't need.
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

function buildSeed(mailingSpecs, { exceptions = [] } = {}) {
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
    exceptions,
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

async function loadAuditRoute() {
  return import("../app/api/audit/route");
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

// --- one audit row per real change, with the right previous/new values ---

test("a mailingStatus change writes exactly one audit row with the prior and new status", { skip }, async () => {
  const db = await freshDb();
  const { POST, NO_SESSION_ACTOR } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  await importSeed(POST, buildSeed([spec]), "seed.xlsx");
  const afterImport = await countRows(db, auditEvents);

  const key = mailingKey({ mailingId: spec.mailingId, sourceRow: spec.sourceRow });
  const response = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key, value: "Mailed" })));
  assert.equal(response.status, 200);

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "mailingStatus"));
  assert.equal(rows.length, 1);
  assert.equal(await countRows(db, auditEvents), afterImport + 1, "exactly one new audit row for this one change");
  assert.equal(rows[0].itemKey, key);
  assert.equal(rows[0].previousValue, "To Prepare", "the status the import itself wrote");
  assert.equal(rows[0].newValue, "Mailed");
  assert.equal(rows[0].actorEmail, NO_SESSION_ACTOR, "this harness calls POST() directly, outside any real Next request scope - see route.ts's own comment on NO_SESSION_ACTOR");
});

test("a componentStatus change writes one audit row with previousValue null on first write, and the prior status on a second", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(2);
  await importSeed(POST, buildSeed([spec]), "seed.xlsx");

  const key = componentKey({ mailingId: spec.mailingId, sourceRow: spec.sourceRow }, "envelope");
  await POST(postRequest(JSON.stringify({ kind: "componentStatus", key, value: "Printed" })));
  const firstRows = await db.select().from(auditEvents).where(and(eq(auditEvents.kind, "componentStatus"), eq(auditEvents.itemKey, key)));
  assert.equal(firstRows.length, 1);
  assert.equal(firstRows[0].previousValue, null, "no prior componentStatus row existed - this was an insert, not an update");
  assert.equal(firstRows[0].newValue, "Printed");

  const secondResponse = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key, value: "Both Printed" })));
  assert.equal(secondResponse.status, 200, `unexpected rejection: ${JSON.stringify(await secondResponse.json().catch(() => null))}`);
  const secondRows = await db.select().from(auditEvents).where(and(eq(auditEvents.kind, "componentStatus"), eq(auditEvents.itemKey, key)));
  assert.equal(secondRows.length, 2, "one row per write, not overwritten");
  const latest = secondRows.find((r) => r.newValue === "Both Printed");
  assert.equal(latest.previousValue, "Printed");
});

test("a reviewedException change writes one audit row with previousValue \"false\" and newValue \"true\"", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(3);
  const exception = { exceptionId: "EXC-1", reason: "Missing email", mailingId: spec.mailingId, subscriberId: spec.subscriberId, shipDate: spec.shipDate, sourceRow: spec.sourceRow };
  await importSeed(POST, buildSeed([spec], { exceptions: [exception] }), "seed.xlsx");

  const key = exceptionReviewKey({ mailingId: spec.mailingId, subscriberId: spec.subscriberId, reason: exception.reason, shipDate: spec.shipDate });
  const response = await POST(postRequest(JSON.stringify({ kind: "reviewedException", key, value: "1" })));
  assert.equal(response.status, 200);

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "reviewedException"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemKey, key);
  assert.equal(rows[0].previousValue, "false");
  assert.equal(rows[0].newValue, "true");
});

test("a crmDataset import writes exactly one audit row with the summary as newValue and no previousValue", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  await importSeed(POST, buildSeed([buildMailing(1), buildMailing(2), buildMailing(3)]), "three-mailings.xlsx");

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "crmDataset"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemKey, "current");
  assert.equal(rows[0].previousValue, null);
  assert.match(rows[0].newValue, /3 mailings, 3 subscribers, 0 exceptions - three-mailings\.xlsx/);
});

// --- soft-skipped writes (key matching no row) must not produce audit rows ---

test("a soft-skipped mailingStatus write (key matches no row) writes no audit row", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const response = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: "MAIL-DOES-NOT-EXIST::999", value: "Mailed" })));
  assert.equal(response.status, 200, "a soft-skip still commits (200), it just changes nothing");
  assert.equal(await countRows(db, auditEvents), 0);
});

test("a soft-skipped componentStatus write (key matches no row) writes no audit row", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const response = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: "MAIL-DOES-NOT-EXIST::999::envelope", value: "Printed" })));
  assert.equal(response.status, 200);
  assert.equal(await countRows(db, auditEvents), 0);
});

test("a soft-skipped reviewedException write (key matches no exception) writes no audit row", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const key = exceptionReviewKey({ mailingId: "MAIL-DOES-NOT-EXIST", subscriberId: "SUB-X", reason: "Missing email", shipDate: "2026-08-15" });
  const response = await POST(postRequest(JSON.stringify({ kind: "reviewedException", key, value: "1" })));
  assert.equal(response.status, 200);
  assert.equal(await countRows(db, auditEvents), 0);
});

// --- transactional atomicity: a rolled-back transaction leaves no audit row ---

test("a rolled-back transaction leaves neither the table write nor its audit row", { skip }, async () => {
  const db = await freshDb();
  const { auditEvents } = await import("../db/schema/audit_events");
  const { subscribers } = await import("../db/schema/subscribers");
  const { writeImport } = await import("../lib/write-to-tables");

  // Same technique as tests/write-to-tables-transactional.e2e.test.mjs's own
  // rollback test: a seed valid enough to get partway through writeImport()
  // (subscribers get written first) but with mailings deliberately missing,
  // which throws a real TypeError once runImport() iterates it - forcing a
  // genuine mid-transaction failure. Called directly via db.transaction(),
  // not through POST, because POST's own shape validation
  // (lib/validate-shared-state.ts) would reject this payload before the
  // transaction ever opens, which would prove nothing about rollback.
  const brokenSeed = {
    subscribers: [{ subscriberId: "SUB-ROLLBACK-AUDIT", email: "rollback@example.com", displayName: "Rollback Audit Test", status: "Active" }],
    recipients: [{ recipientId: "REC-ROLLBACK-AUDIT", subscriberId: "SUB-ROLLBACK-AUDIT", name: "Rollback Audit Test", address: "1 Test St" }],
    subscriptions: [],
    orders: [],
    mailings: undefined,
    exceptions: [],
  };

  await assert.rejects(
    db.transaction(async (tx) => {
      await writeImport(brokenSeed, tx);
      // Mirrors route.ts's real ordering (writeImport, then the audit
      // insert) - never reached here since writeImport() throws first, but
      // written explicitly so this test proves the same shape route.ts
      // actually runs, not just "writeImport alone rolls back."
      await tx.insert(auditEvents).values({ actorEmail: "test@example.com", kind: "crmDataset", itemKey: "current", previousValue: null, newValue: "1 subscriber" });
    }),
    /mailings|iterable|undefined/i,
  );

  assert.equal(await countRows(db, subscribers), 0, "the subscriber write earlier in the same transaction rolled back");
  assert.equal(await countRows(db, auditEvents), 0, "no audit row survives a rolled-back transaction");
});

// --- exceptions: all four exceptionReviewKey segments are now cross-checked ---

test("a reviewedException key matching all four segments is applied", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { exceptions } = await import("../db/schema/exceptions");

  const spec = buildMailing(4);
  const exception = { exceptionId: "EXC-4", reason: "Missing email", mailingId: spec.mailingId, subscriberId: spec.subscriberId, shipDate: spec.shipDate, sourceRow: spec.sourceRow };
  await importSeed(POST, buildSeed([spec], { exceptions: [exception] }), "seed.xlsx");

  const key = exceptionReviewKey({ mailingId: spec.mailingId, subscriberId: spec.subscriberId, reason: exception.reason, shipDate: spec.shipDate });
  const response = await POST(postRequest(JSON.stringify({ kind: "reviewedException", key, value: "1" })));
  assert.equal(response.status, 200);

  const rows = await db.select({ reviewed: exceptions.reviewed }).from(exceptions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reviewed, true);
});

test("a reviewedException key differing only in subscriberId is NOT applied - previously indistinguishable from a real match", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { exceptions } = await import("../db/schema/exceptions");

  const spec = buildMailing(5);
  const exception = { exceptionId: "EXC-5", reason: "Missing email", mailingId: spec.mailingId, subscriberId: spec.subscriberId, shipDate: spec.shipDate, sourceRow: spec.sourceRow };
  await importSeed(POST, buildSeed([spec], { exceptions: [exception] }), "seed.xlsx");

  // Same mailingId and reason as the real exception (which is all the old,
  // 2-segment matcher would have checked) - only subscriberId differs.
  const wrongKey = exceptionReviewKey({ mailingId: spec.mailingId, subscriberId: "SUB-SOMEONE-ELSE", reason: exception.reason, shipDate: spec.shipDate });
  const response = await POST(postRequest(JSON.stringify({ kind: "reviewedException", key: wrongKey, value: "1" })));
  assert.equal(response.status, 200, "a non-matching key is a soft-skip (200), not an error");

  const rows = await db.select({ reviewed: exceptions.reviewed }).from(exceptions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reviewed, false, "must not have been marked reviewed by a key differing only in subscriberId");
});

test("a reviewedException key differing only in shipDate is NOT applied", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { exceptions } = await import("../db/schema/exceptions");

  const spec = buildMailing(6);
  const exception = { exceptionId: "EXC-6", reason: "Missing email", mailingId: spec.mailingId, subscriberId: spec.subscriberId, shipDate: spec.shipDate, sourceRow: spec.sourceRow };
  await importSeed(POST, buildSeed([spec], { exceptions: [exception] }), "seed.xlsx");

  const wrongKey = exceptionReviewKey({ mailingId: spec.mailingId, subscriberId: spec.subscriberId, reason: exception.reason, shipDate: "2026-01-01" });
  const response = await POST(postRequest(JSON.stringify({ kind: "reviewedException", key: wrongKey, value: "1" })));
  assert.equal(response.status, 200);

  const rows = await db.select({ reviewed: exceptions.reviewed }).from(exceptions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reviewed, false, "must not have been marked reviewed by a key differing only in shipDate");
});

// --- the real 1,218-row fixture still imports end to end, with the audit log wired in ---

test("a full import of the real 1,218-row fixture still works end to end and writes exactly one audit row", { skip: skipRequiresFixture }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");
  const { mailings } = await import("../db/schema/mailings");

  const fixedNow = new Date("2026-08-12T15:00:00.000Z");
  const rows = loadSpreadsheetRows();
  const appJs = await loadAppJsSandbox(fixedNow);
  const seed = appJs.buildSeedFromSpreadsheet(rows, "Import_20260812_181828.xlsx", fixedNow, []);

  const value = JSON.stringify({ seed, sourceName: "Import_20260812_181828.xlsx", uploadedAt: fixedNow.toISOString(), summary: seed.summary });
  const response = await POST(postRequest(JSON.stringify({ kind: "crmDataset", key: "current", value })));
  assert.equal(response.status, 200, `the real fixture should import cleanly with the audit log wired in: ${JSON.stringify(await response.json().catch(() => null))}`);
  assert.equal(await countRows(db, mailings), 1197, "same already-established write count this task didn't change - see shared-state-validation.e2e.test.mjs");

  const rowsWritten = await countRows(db, auditEvents);
  assert.equal(rowsWritten, 1, "a full 1,218-row import is one audit_events row, not one per mailing - see route.ts's own comment on why");
});

// --- read endpoint: newest-first, respects its limit ---

test("GET /api/audit returns events newest-first and respects its limit", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const { GET } = await loadAuditRoute();

  const spec = buildMailing(7);
  await importSeed(POST, buildSeed([spec]), "seed.xlsx"); // audit row 1: crmDataset
  await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: mailingKey({ mailingId: spec.mailingId, sourceRow: spec.sourceRow }), value: "Mailed" }))); // row 2
  await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: componentKey({ mailingId: spec.mailingId, sourceRow: spec.sourceRow }, "envelope"), value: "Printed" }))); // row 3

  const response = await GET(new Request("http://localhost/api/audit"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.events.length, 3);
  // Newest-first: the last write (componentStatus) is events[0], the import
  // (first write) is events[2].
  assert.equal(body.events[0].kind, "componentStatus");
  assert.equal(body.events[1].kind, "mailingStatus");
  assert.equal(body.events[2].kind, "crmDataset");

  const limited = await GET(new Request("http://localhost/api/audit?limit=2"));
  const limitedBody = await limited.json();
  assert.equal(limitedBody.events.length, 2);
  assert.equal(limitedBody.events[0].kind, "componentStatus");
  assert.equal(limitedBody.events[1].kind, "mailingStatus");
});

test("GET /api/audit rejects a non-numeric limit (400)", { skip }, async () => {
  await freshDb();
  const { GET } = await loadAuditRoute();
  const response = await GET(new Request("http://localhost/api/audit?limit=not-a-number"));
  assert.equal(response.status, 400);
});

// GET /api/audit itself has no auth check in its own code - it relies on
// proxy.ts's matcher, the same way every other route in this app does
// (api/health and api/auth are the only two explicit exemptions). Calling
// GET() directly here, like every other e2e test in this suite calls its
// route handler directly, bypasses proxy.ts entirely - so there is no way
// to prove enforcement by calling the exported function, only by proving
// the route is NOT one of proxy.ts's exemptions (structural, not runtime,
// verification - noted here rather than skipped silently).
test("proxy.ts's matcher does not exempt /api/audit - the actual auth enforcement mechanism", { skip: false }, async () => {
  const { config } = await import("../proxy");
  const [pattern] = config.matcher;
  const matcher = new RegExp(`^${pattern}$`);
  assert.ok(matcher.test("/api/audit"), "/api/audit must be covered by proxy.ts's matcher (not exempted) for auth to apply");
  // Controls: a route that IS exempted must not match, proving this regex
  // check actually discriminates rather than matching everything.
  assert.ok(!matcher.test("/api/health"), "sanity check: api/health IS exempted and must not match");
});
