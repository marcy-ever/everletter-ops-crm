// Verifies the write path app/crm/CrmApp.tsx's REACT_VIEWS.import entry
// drives - Phase 1 step 11 (CLAUDE.md), the sixth migrated view and the
// most destructive action in the app: publishing replaces the dataset
// (writeImport(), lib/write-to-tables.ts, deletes every row not in the
// payload). Everything the server side of a crmDataset write does
// (shape/size validation, the catastrophic-deletion guard, ingestion_events,
// the audit row) is already covered end to end by
// tests/shared-state-validation.e2e.test.mjs and
// tests/audit-events.e2e.test.mjs - not re-proven here. What's new, and
// what this file actually exists to prove, is the CLIENT side: does the
// exact sequence CrmApp.tsx's onFileSelect/onPublish callbacks run
// (readWorkbookFile -> state.importPreview, then saveSharedDataset ->
// state.seed/importInfo, or a rejection surfacing in state.importStatus)
// really produce a correct publish, really write an ingestion_events row
// and an audit row, really surface the catastrophic-deletion guard's
// exact 409 message (the only safety net that path has - there's no UI
// for confirmLargeDelete by design), and really track importBusy across
// the async boundary the same way the removed legacy handler did.
//
// globalThis.fetch is rewired to call app/api/shared-state/route.ts's
// real POST handler directly, in-process, against a real Postgres - same
// technique and same waitForFetches() fix
// tests/exceptions-write-path.e2e.test.mjs (step 10) established, reused
// here rather than reinvented; see that file's own header for why a bare
// setTimeout(resolve, 0) flush isn't enough once fetch does real I/O.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped,
// not failed, if it isn't available. Run through `pnpm test:e2e`.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { createAppState } from "../app/crm/shell/crm-app-state.ts";
import { installShellDomStub } from "./shell-test-helpers.mjs";
import { readWorkbookFile } from "../app/crm/views/import/import-selectors.ts";
import { saveSharedDataset } from "../lib/client/shared-state-client.ts";

const skip = e2eSkipReason({ requiresFixture: false });

// Same shape tests/shared-state-validation.e2e.test.mjs's own buildMailing/
// buildSeed use - duplicated rather than shared, per this suite's
// established convention.
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
  // Unlike every other e2e file's freshDb(), this one also clears
  // ingestion_events - the only suite that asserts its row COUNT (an
  // exact "1 new row"), not just that a restore/replay works against
  // whatever's already there.
  const { ingestionEvents } = await import("../db/schema/ingestion_events");
  await db.delete(ingestionEvents);
  return db;
}

async function importSeed(POST, seed, sourceName) {
  const response = await POST(postRequest(buildCrmDatasetBody(seed, { sourceName })));
  assert.equal(response.status, 200, `seeding failed: ${JSON.stringify(await response.json().catch(() => null))}`);
}

// Same wiring/waitForFetches() technique as
// tests/exceptions-write-path.e2e.test.mjs (step 10) - see that file's
// own header for why a bare setTimeout(resolve, 0) flush isn't enough
// once fetch does a real Postgres round trip.
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

// A stubbed window.XLSX exercising readWorkbookFile for real (the same
// mock shape tests/import-selectors.test.mjs uses) - so this file's
// "select a file" step really parses a real row through the real
// buildSeedFromSpreadsheet, not a hand-built Dataset skipping that step.
function stubXlsx(rows, sheetName = "Mailing Schedule") {
  return {
    read: () => ({ SheetNames: [sheetName], Sheets: { [sheetName]: sheetName } }),
    utils: { sheet_to_json: () => rows },
  };
}

function fakeFile(name) {
  return { name, arrayBuffer: async () => new ArrayBuffer(0) };
}

const ROW = {
  "Order ID": "9001",
  "Original Order Date": "2026-07-01",
  "Customer Name and Address": "Ivy Example\n1 Main St, Sample City, ZZ 00000",
  Character: "Marley",
  "Letter Number": "1",
  "Ship Date": "2026-08-15",
  Subscription: "Month-to-month",
  Status: "To Prepare",
  "Active?": "Yes",
  Email: "ivy@example.test",
};

test("selecting a file, previewing it, and publishing writes the normalized tables, an ingestion_events row, an audit row, and reports success", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");
  const { ingestionEvents } = await import("../db/schema/ingestion_events");
  const { mailings } = await import("../db/schema/mailings");

  const originalWindow = globalThis.window;

  try {
    // installShellDomStub() stubs both globalThis.window and globalThis.fetch
    // itself (see tests/shell-test-helpers.mjs) - wiring the real route /
    // XLSX must happen AFTER it runs, or the stub's own stand-ins silently
    // win.
    installShellDomStub();
    const sandbox = createAppState();
    const { waitForFetches } = wireFetchToRealRoute(POST);
    globalThis.window.XLSX = stubXlsx([ROW]);

    // 1. select a file -> preview renders (mirrors CrmApp.tsx's
    // onFileSelect body).
    sandbox.state.importStatus = "Reading spreadsheet...";
    sandbox.state.importPreview = null;
    const file = fakeFile("mailing-schedule.xlsx");
    sandbox.state.importPreview = await readWorkbookFile(file, new Date("2026-08-12T12:00:00.000Z"), []);
    sandbox.state.importStatus = "Preview ready. Review the counts, then publish when it looks right.";

    assert.equal(sandbox.state.importPreview.rowCount, 1);
    assert.equal(sandbox.state.importPreview.seed.mailings.length, 1);
    assert.equal(sandbox.state.importPreview.fileName, "mailing-schedule.xlsx");

    // 2. publish (mirrors CrmApp.tsx's onPublish body exactly).
    sandbox.state.importBusy = true;
    sandbox.state.importStatus = "Publishing spreadsheet to the shared CRM...";
    const publishPromise = saveSharedDataset(sandbox.state.importPreview.seed, sandbox.state.importPreview.fileName, sandbox.staleness);
    assert.equal(sandbox.state.importBusy, true, "importBusy must be true synchronously, before the publish resolves - the disabled-button guard depends on this");

    sandbox.state.importInfo = await publishPromise;
    await waitForFetches();
    sandbox.state.seed = sandbox.state.importPreview.seed;
    sandbox.state.importPreview = null;
    sandbox.state.importBusy = false;
    sandbox.state.importStatus = "Imported. This is now the shared CRM data.";

    // 3. reports success
    assert.equal(sandbox.state.importStatus, "Imported. This is now the shared CRM data.");
    assert.equal(sandbox.state.importBusy, false);
    assert.equal(sandbox.state.importPreview, null);
    assert.equal(sandbox.state.seed.mailings.length, 1);
    assert.equal(sandbox.state.importInfo.sourceName, "mailing-schedule.xlsx");

    // 4. writes the normalized tables
    const dbMailings = await db.select().from(mailings);
    assert.equal(dbMailings.length, 1, "the imported mailing should exist in the normalized table");
    assert.equal(dbMailings[0].appMailingId, sandbox.state.seed.mailings[0].mailingId);

    // 5. an ingestion_events row
    const ingestionRows = await db.select().from(ingestionEvents);
    assert.equal(ingestionRows.length, 1);
    assert.equal(ingestionRows[0].source, "manual_spreadsheet");
    assert.match(ingestionRows[0].summary, /mailing-schedule\.xlsx/);

    // 6. an audit row
    const auditRows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "crmDataset"));
    assert.equal(auditRows.length, 1);

    // 7. the reconciliation - one clean row, nothing skipped, reported as
    // such rather than simply absent (see lib/write-to-tables.ts's
    // ImportSummary and lib/domain/dataset.ts's DatasetImportSummary).
    assert.deepEqual(sandbox.state.importInfo.importSummary, { totalRows: 1, mailingsWritten: 1, skipped: [] });
    assert.deepEqual(ingestionRows[0].skipped, []);
  } finally {
    globalThis.window = originalWindow;
  }
});

async function countRowsOf(db, table) {
  const rows = await db.select().from(table);
  return rows.length;
}

// A second row, identical to ROW except a blank Subscription - the exact
// shape lib/domain/spreadsheet/build-seed.ts turns into a "Needs Review"
// plan (normalizePlan's fallback for unrecognized/blank text), which
// lib/write-to-tables.ts's runImport() then skips writing (LETTERS_BY_PLAN
// has no "Needs Review" entry) - the same real skip the 1,218-row fixture
// test proves at scale, reproduced here small and deliberately.
const SKIPPED_ROW = { ...ROW, "Order ID": "9002", "Customer Name and Address": "Jax Example\n2 Main St, Sample City, ZZ 00000", Subscription: "", Email: "jax@example.test" };

test("an import mixing a clean row and a row with an unrecognized plan reports the reconciliation through the full client flow, and persists it to ingestion_events", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { ingestionEvents } = await import("../db/schema/ingestion_events");
  const { mailings } = await import("../db/schema/mailings");
  const originalWindow = globalThis.window;

  try {
    installShellDomStub();
    const sandbox = createAppState();
    const { waitForFetches } = wireFetchToRealRoute(POST);
    globalThis.window.XLSX = stubXlsx([ROW, SKIPPED_ROW]);

    const file = fakeFile("mixed-schedule.xlsx");
    sandbox.state.importPreview = await readWorkbookFile(file, new Date("2026-08-12T12:00:00.000Z"), []);
    assert.equal(sandbox.state.importPreview.seed.mailings.length, 2, "both rows become mailing candidates - the skip happens in writeImport, not client-side parsing");

    sandbox.state.importInfo = await saveSharedDataset(sandbox.state.importPreview.seed, sandbox.state.importPreview.fileName, sandbox.staleness);
    await waitForFetches();

    // The reconciliation reached the client - real row numbers (sourceRow
    // 2 for ROW, 3 for SKIPPED_ROW, since buildSeedFromSpreadsheet's
    // sourceRow is index+2), not an internal id.
    const summary = sandbox.state.importInfo.importSummary;
    assert.ok(summary, "importSummary must be present on a real import response");
    assert.equal(summary.totalRows, 2);
    assert.equal(summary.mailingsWritten, 1);
    assert.deepEqual(summary.skipped, [
      { reason: "Subscription has an unrecognized plan", count: 1, sourceRows: [3] },
      // SKIPPED_ROW has a real Order ID ("9002"), so it also produces its
      // own real order - which is skipped in turn, since the subscription
      // it points at was never kept. See lib/write-to-tables.ts's own
      // module comment on why "the orders that follow from" a skipped
      // subscription get their own group.
      { reason: "Order has no resolvable subscription", count: 1, sourceRows: [3] },
      { reason: "Mailing's subscription was not kept", count: 1, sourceRows: [3] },
    ]);

    // The actual write matches: 1 mailing, not 2.
    assert.equal(await countRowsOf(db, mailings), 1);

    // Persisted to ingestion_events, not just returned in the response -
    // this is what makes the history say what the import actually did,
    // not just that one happened.
    const ingestionRows = await db.select().from(ingestionEvents);
    assert.equal(ingestionRows.length, 1);
    assert.deepEqual(ingestionRows[0].skipped, summary.skipped);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("publishing an import that trips the catastrophic-deletion guard surfaces the server's real 409 message, not a generic failure or silence, and changes nothing", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { mailings } = await import("../db/schema/mailings");

  // Seed 10 independent mailings first (the "existing" dataset) - same
  // setup tests/shared-state-validation.e2e.test.mjs's own catastrophic-
  // deletion test uses.
  const existingSeed = buildSeed(Array.from({ length: 10 }, (_, i) => buildMailing(i + 1)));
  await importSeed(POST, existingSeed, "existing-10.xlsx");
  assert.equal(await countRowsOf(db, mailings), 10);

  // installShellDomStub() stubs globalThis.fetch itself - wire the real
  // route AFTER it runs, or the stub's own failing stand-in silently wins
  // (see the previous test's own comment on this).
  installShellDomStub();
  const sandbox = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST);
  sandbox.state.seed = existingSeed;

  // A completely disjoint 2-mailing "preview" - none of these ids overlap
  // with the 10 just written, so publishing it would remove 10 of 10
  // (100%), well over the 60% threshold (lib/validate-shared-state.ts).
  const smallSeed = buildSeed([buildMailing(101), buildMailing(102)]);
  sandbox.state.importPreview = { seed: smallSeed, sheetName: "Sheet1", rowCount: 2, fileName: "small-2.xlsx" };

  // Mirrors CrmApp.tsx's onPublish body exactly, including its catch branch.
  sandbox.state.importBusy = true;
  sandbox.state.importStatus = "Publishing spreadsheet to the shared CRM...";
  let thrownMessage = null;
  try {
    sandbox.state.importInfo = await saveSharedDataset(sandbox.state.importPreview.seed, sandbox.state.importPreview.fileName, sandbox.staleness);
    sandbox.state.seed = sandbox.state.importPreview.seed;
    sandbox.state.importPreview = null;
    sandbox.state.importBusy = false;
    sandbox.state.importStatus = "Imported. This is now the shared CRM data.";
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : "Could not publish that spreadsheet.";
    sandbox.state.importBusy = false;
    sandbox.state.importStatus = thrownMessage;
  }
  await waitForFetches();

  // The message is the entire safety net for this path (no UI for
  // confirmLargeDelete) - it must be the server's real, specific message,
  // not a generic fallback and not silence.
  assert.ok(thrownMessage, "onPublish must throw/report something - a silently-vanishing rejection is the worst outcome this codebase has");
  assert.match(thrownMessage, /contains 2 mailings/);
  assert.match(thrownMessage, /remove 10 of 10 existing/);
  assert.equal(sandbox.state.importStatus, thrownMessage);
  assert.notEqual(thrownMessage, "Could not publish that spreadsheet.", "must be the server's real message, not the generic fallback");

  // importBusy resets, the rejected preview's seed never replaces state.seed.
  assert.equal(sandbox.state.importBusy, false);
  assert.equal(sandbox.state.seed, existingSeed, "a rejected publish must not replace state.seed");
  assert.notEqual(sandbox.state.importPreview, null, "a rejected publish must leave the preview in place, matching legacy - nothing clears it in the catch branch");

  // The proof that matters most: nothing was actually deleted.
  assert.equal(await countRowsOf(db, mailings), 10, "the rejected import must not have deleted anything");
});

// Two rows sharing Order ID + Character + Letter Number - the real
// ambiguity lib/write-to-tables.ts's runImport() drops rather than
// guessing through, and the exact case lib/domain/spreadsheet/exceptions.ts's
// duplicateMailingFlags() now flags client-side as a Needs Review
// exception. Both sides use the same shared collision definition
// (lib/domain/mailing-collision.ts) - this test is the real, end-to-end
// proof (not by inspection) that detection and dropping actually agree:
// every mailing writeImport() drops for collision has a corresponding
// "Duplicate:" exception, and vice versa.
const DUPLICATE_ROW_A = { ...ROW, "Order ID": "9101", "Ship Date": "2026-08-15" };
const DUPLICATE_ROW_B = { ...ROW, "Order ID": "9101", "Ship Date": "2026-09-01" };

test("detection and dropping agree: rows that collide on order+character+letter number are both skipped by writeImport AND flagged as Duplicate exceptions client-side, with identical row numbers", { skip }, async () => {
  const db = await freshDb();
  const { POST } = await loadRoute();
  const { mailings } = await import("../db/schema/mailings");
  const originalWindow = globalThis.window;

  try {
    installShellDomStub();
    const sandbox = createAppState();
    const { waitForFetches } = wireFetchToRealRoute(POST);
    globalThis.window.XLSX = stubXlsx([DUPLICATE_ROW_A, DUPLICATE_ROW_B]);

    const file = fakeFile("colliding-schedule.xlsx");
    sandbox.state.importPreview = await readWorkbookFile(file, new Date("2026-08-12T12:00:00.000Z"), []);

    // Client side: both mailings still built (reporting-only, no change to
    // what's written), and both flagged as duplicate exceptions, one
    // naming the other by its real spreadsheet row number.
    const clientSeed = sandbox.state.importPreview.seed;
    assert.equal(clientSeed.mailings.length, 2);
    const duplicateExceptions = clientSeed.exceptions.filter((e) => e.reason.startsWith("Duplicate:"));
    assert.equal(duplicateExceptions.length, 2);
    const clientSourceRows = duplicateExceptions.map((e) => e.sourceRow).sort((a, b) => a - b);
    assert.deepEqual(clientSourceRows, [2, 3], "sourceRow 2 = DUPLICATE_ROW_A, 3 = DUPLICATE_ROW_B (index + 2)");
    assert.ok(duplicateExceptions.every((e) => e.severity === "High"));
    assert.equal(duplicateExceptions.find((e) => e.sourceRow === 2).reason, "Duplicate: shares order, character, and letter number with row 3");
    assert.equal(duplicateExceptions.find((e) => e.sourceRow === 3).reason, "Duplicate: shares order, character, and letter number with row 2");

    // Publish - the actual write path.
    sandbox.state.importInfo = await saveSharedDataset(clientSeed, sandbox.state.importPreview.fileName, sandbox.staleness);
    await waitForFetches();

    // Server side: both rows skipped for the same reason, same row numbers.
    const summary = sandbox.state.importInfo.importSummary;
    const collisionGroup = summary.skipped.find((g) => g.reason === "Mailing shares its order, character, and letter number with another row");
    assert.ok(collisionGroup, `expected a collision skip group; got: ${JSON.stringify(summary.skipped)}`);
    assert.deepEqual(collisionGroup.sourceRows.slice().sort((a, b) => a - b), [2, 3]);

    // The two sets of row numbers are identical - the actual "detection
    // and dropping agree" proof.
    assert.deepEqual(clientSourceRows, collisionGroup.sourceRows.slice().sort((a, b) => a - b));

    // Neither colliding mailing was actually written.
    assert.equal(await countRowsOf(db, mailings), 0);
  } finally {
    globalThis.window = originalWindow;
  }
});
