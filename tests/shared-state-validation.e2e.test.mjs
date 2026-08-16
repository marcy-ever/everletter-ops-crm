// Verifies POST /api/shared-state's safety gate end to end, against a real
// Postgres and the real route handler (app/api/shared-state/route.ts) - not
// mocks. This is the largest data-integrity gap the app had: writeImport()
// (lib/write-to-tables.ts) deletes every subscriber/subscription/order/
// mailing/exception not present in an incoming crmDataset payload, and until
// this test suite's own task, nothing validated shape, capped size, or
// guarded against a catastrophic accidental deletion before that write ran.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped, not
// failed, if it isn't available. Run through `pnpm test:e2e` (not `node
// --test` directly) - see docs/testing.md for why these files must be
// serialized.
import test from "node:test";
import assert from "node:assert/strict";
import { e2eSkipReason, loadAppJsSandbox, loadSpreadsheetRows, truncateAllTables } from "./e2e-helpers.mjs";
import { countRows } from "./db-test-helpers.mjs";

const skip = e2eSkipReason({ requiresFixture: false });
const skipRequiresFixture = e2eSkipReason();

// Builds one self-contained mailing plus its subscriber/recipient/
// subscription/order, all under ids derived from `n` so callers can build
// N independent mailings with zero cross-references between them - exactly
// what the catastrophic-deletion tests need (importing a small, disjoint
// set of mailings should read as "delete nearly everything", not overlap
// with whatever was there before).
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

// Assembles a full Seed-shaped dataset (see lib/write-to-tables.ts's Seed
// interface) from a list of buildMailing() records - one subscriber/
// recipient/subscription/order per mailing, plus the mailing itself.
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

// Wraps a Seed into the exact outer POST body app.js's saveSharedDataset()
// (lib/client/shared-state-client.ts) sends - {kind, key, value}, value
// itself a JSON string of {seed, sourceName, uploadedAt, summary}.
function buildCrmDatasetBody(seed, { sourceName = "test-fixture.xlsx", confirmLargeDelete } = {}) {
  const value = JSON.stringify({ seed, sourceName, uploadedAt: new Date().toISOString(), summary: {} });
  const body = { kind: "crmDataset", key: "current", value };
  if (confirmLargeDelete !== undefined) body.confirmLargeDelete = confirmLargeDelete;
  return JSON.stringify(body);
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
  return db;
}

// --- malformed keys: 400, for every kind that has a key to parse ---

test("POST rejects a malformed mailingStatus key (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: "not-a-valid-key-no-separator", value: "Mailed" })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /mailingKey/i);
});

test("POST rejects a malformed componentStatus key (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: "MAIL-X::1", value: "Printed" })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /componentKey/i);
});

test("POST rejects a malformed reviewedException key (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest(JSON.stringify({ kind: "reviewedException", key: "MAIL-X::SUB-X", value: "1" })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /exceptionReviewKey/i);
});

// --- invalid values: 400, for every kind that has a value to check ---

test("POST rejects an unrecognized mailingStatus value (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest(JSON.stringify({ kind: "mailingStatus", key: "MAIL-X::1", value: "Not A Real Status" })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /not a valid mailing status/i);
});

test("POST rejects an unrecognized componentStatus value for a known field (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: "MAIL-X::1::envelope", value: "Not A Real Option" })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /not a valid status for the "envelope" component/i);
});

test("POST rejects componentStatus for an unknown field entirely (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest(JSON.stringify({ kind: "componentStatus", key: "MAIL-X::1::bogus-field", value: "anything" })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /not a known component field/i);
});

// --- crmDataset shape validation ---

test("POST rejects a crmDataset payload missing a required array field (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const seed = buildSeed([buildMailing(1)]);
  delete seed.mailings;
  const response = await POST(postRequest(buildCrmDatasetBody(seed)));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /mailings/);
});

test("POST rejects a crmDataset payload where an array field isn't an array (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const seed = buildSeed([buildMailing(1)]);
  seed.subscribers = "not an array";
  const response = await POST(postRequest(buildCrmDatasetBody(seed)));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /subscribers/);
});

test("POST rejects a crmDataset value that isn't valid JSON (400)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest(JSON.stringify({ kind: "crmDataset", key: "current", value: "{not json" })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /not valid JSON/i);
});

test("POST rejects a request body that isn't valid JSON at all (400, not 500)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const response = await POST(postRequest("this is not json"));
  assert.equal(response.status, 400);
});

// --- size cap ---

test("POST rejects an oversized body via the real byte count (413)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const { MAX_PAYLOAD_BYTES } = await import("../lib/validate-shared-state");
  // A genuinely oversized body - no content-length header is set by
  // Request for a string body (verified directly), so this exercises the
  // real-byte-count fallback path, not the header fast-path.
  const oversized = "x".repeat(MAX_PAYLOAD_BYTES + 1024);
  const response = await POST(postRequest(oversized));
  assert.equal(response.status, 413);
});

test("POST rejects a request whose declared content-length alone exceeds the cap (413, before the body is even read for content)", { skip }, async () => {
  await freshDb();
  const { POST } = await loadRoute();
  const { MAX_PAYLOAD_BYTES } = await import("../lib/validate-shared-state");
  const request = new Request("http://localhost/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json", "content-length": String(MAX_PAYLOAD_BYTES + 1) },
    body: JSON.stringify({ kind: "mailingStatus", key: "MAIL-X::1", value: "Mailed" }),
  });
  const response = await POST(request);
  assert.equal(response.status, 413);
});

// --- catastrophic-deletion guard: the core proof this task exists for ---

test("POST refuses a crmDataset import that would delete most of the existing mailings (409, with real numbers), and PROVES nothing was deleted", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { mailings } = await import("../db/schema/mailings");

  // Seed 10 independent mailings first (the "existing" dataset).
  const existingSeed = buildSeed(Array.from({ length: 10 }, (_, i) => buildMailing(i + 1)));
  const seedResponse = await POST(postRequest(buildCrmDatasetBody(existingSeed, { sourceName: "existing-10.xlsx" })));
  assert.equal(seedResponse.status, 200, `seeding the existing 10 mailings failed: ${JSON.stringify(await seedResponse.json().catch(() => null))}`);
  assert.equal(await countRows(db, mailings), 10);

  // A completely disjoint 2-mailing import - none of these ids overlap
  // with the 10 just written, so this would remove all 10 of 10 (100%),
  // well over the 60% threshold (lib/validate-shared-state.ts).
  const smallSeed = buildSeed([buildMailing(101), buildMailing(102)]);
  const response = await POST(postRequest(buildCrmDatasetBody(smallSeed, { sourceName: "small-2.xlsx" })));

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /contains 2 mailings/);
  assert.match(body.error, /remove 10 of 10 existing/);

  // The proof that matters most: a 409 that arrived after the delete
  // already happened would be worse than no check at all.
  assert.equal(await countRows(db, mailings), 10, "the rejected import must not have deleted anything - all 10 original mailings should still be there");
});

test("the same catastrophic import succeeds with confirmLargeDelete: true, and actually applies this time", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { mailings } = await import("../db/schema/mailings");

  const existingSeed = buildSeed(Array.from({ length: 10 }, (_, i) => buildMailing(i + 1)));
  await POST(postRequest(buildCrmDatasetBody(existingSeed, { sourceName: "existing-10.xlsx" })));
  assert.equal(await countRows(db, mailings), 10);

  const smallSeed = buildSeed([buildMailing(101), buildMailing(102)]);
  const response = await POST(postRequest(buildCrmDatasetBody(smallSeed, { sourceName: "small-2.xlsx", confirmLargeDelete: true })));

  assert.equal(response.status, 200, `override should have let this through: ${JSON.stringify(await response.json().catch(() => null))}`);
  assert.equal(await countRows(db, mailings), 2, "with the override, the large deletion should actually have happened this time");
});

test("a normal-sized crmDataset import (well under the threshold) succeeds without needing the override", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { mailings } = await import("../db/schema/mailings");

  const first = buildSeed(Array.from({ length: 10 }, (_, i) => buildMailing(i + 1)));
  await POST(postRequest(buildCrmDatasetBody(first, { sourceName: "first-10.xlsx" })));
  assert.equal(await countRows(db, mailings), 10);

  // Keep 8 of the original 10 (mailings 1-8) and add 1 new one - an 20%
  // deletion (2 of 10), comfortably under the 60% threshold.
  const second = buildSeed([...Array.from({ length: 8 }, (_, i) => buildMailing(i + 1)), buildMailing(200)]);
  const response = await POST(postRequest(buildCrmDatasetBody(second, { sourceName: "second-9.xlsx" })));

  assert.equal(response.status, 200, `a legitimate, modest-churn import should not need the override: ${JSON.stringify(await response.json().catch(() => null))}`);
  assert.equal(await countRows(db, mailings), 9);
});

// --- a fully valid import still works end to end ---

test("a fully valid crmDataset import still writes normalized rows and returns 200, exactly as before this change", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { subscribers } = await import("../db/schema/subscribers");
  const { mailings } = await import("../db/schema/mailings");

  const seed = buildSeed(Array.from({ length: 5 }, (_, i) => buildMailing(i + 1)));
  const response = await POST(postRequest(buildCrmDatasetBody(seed, { sourceName: "valid-import.xlsx" })));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  // POST now also returns the post-write change marker (lib/change-marker.ts,
  // added for the "someone else changed something" staleness feature) -
  // unrelated to what this test itself proves, so only its shape is
  // checked, not a specific value.
  assert.ok(typeof body.marker === "number" || body.marker === null);
  assert.equal(await countRows(db, subscribers), 5);
  assert.equal(await countRows(db, mailings), 5);
});

// The real fixture, posted through the real route, exactly the way the
// actual browser Import Sheet flow does it (app/crm/legacy-app.js's
// buildSeedFromSpreadsheet -> lib/client/shared-state-client.ts's
// saveSharedDataset -> this POST body shape) - not a synthetic small seed.
// This is what the measured size cap and shape validation are calibrated
// against; every other test in this file uses small synthetic seeds for
// speed and precise control, but none of them alone proves the real,
// full-size payload actually clears every check. Requires the real,
// gitignored test spreadsheet - skipped, not failed, if it isn't present.
test("the real 1,218-row fixture, posted through the real route exactly as the browser would send it, clears validation/size/catastrophic checks and writes normalized rows", { skip: skipRequiresFixture }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { mailings } = await import("../db/schema/mailings");

  const fixedNow = new Date("2026-08-12T15:00:00.000Z");
  const rows = loadSpreadsheetRows();
  const appJs = await loadAppJsSandbox(fixedNow);
  const seed = appJs.buildSeedFromSpreadsheet(rows, "Import_20260812_181828.xlsx", fixedNow, []);

  const value = JSON.stringify({ seed, sourceName: "Import_20260812_181828.xlsx", uploadedAt: fixedNow.toISOString(), summary: seed.summary });
  const outerBody = JSON.stringify({ kind: "crmDataset", key: "current", value });

  const response = await POST(postRequest(outerBody));
  assert.equal(response.status, 200, `the real fixture should clear every check on a first import (empty DB, well under the size cap): ${JSON.stringify(await response.json().catch(() => null))}`);
  // 1,218 raw spreadsheet rows, but writeImport() itself (unchanged by
  // this task) skips a documented handful (missing ship dates, the real
  // ORD-2858 duplicate, unrecognized-plan subscriptions) - 1,197 written
  // is the same real, already-established count, not a number this task
  // introduced. See lib/build-dataset-from-tables.ts's module comment /
  // docs/schema-design.md for exactly which rows and why.
  assert.equal(seed.mailings.length, 1218);
  assert.equal(await countRows(db, mailings), 1197);
});
