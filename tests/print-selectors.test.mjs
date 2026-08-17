// Coverage for app/crm/views/envelope-print/print-selectors.ts - Phase 1
// step 17 (CLAUDE.md), the last of twelve views. Exercises
// computePrintData()'s own filter chain (active/high-exception/status/
// envelope-Need-Print/scope/search, its own envelope-stock/character-key/
// name sort), the envelope-stock groupings, per-row Drive-link display
// data, and the effectivePrintStockFilter self-correction (the pure
// replacement for legacy's own state-mutating-during-render quirk).
import assert from "node:assert/strict";
import test from "node:test";
import { computePrintData } from "../app/crm/views/envelope-print/print-selectors.ts";

// Default plan is Month-to-month, deliberately: printModeForPlan("Month-to-month")
// is not "Prepaid bulk", so defaultComponentStatus's own envelope default
// (lib/client/selectors.ts) comes out "Need Print" with zero overrides -
// the state computePrintData's own baseRows filter requires. A 6/12-month
// mailing defaults to "In Ashley Box" instead (real behavior, not a test
// gap) - tests below that specifically want a prepaid-plan row inside
// baseRows pass an explicit componentOverrides entry to get there, same as
// a real prepaid mailing would need an explicit status change to become
// print-ready.
function mailing(overrides = {}) {
  return {
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    recipientId: "REC-1",
    orderId: "ORD-1",
    orderDate: "2026-01-01",
    subscriptionId: "PLAN-1",
    recipientName: "Ava Example",
    email: "ava@example.test",
    character: "Ringo",
    plan: "Month-to-month",
    letterNumber: "1",
    shipDate: "2026-08-15",
    suggestedShipDate: "2026-08-15",
    status: "To Prepare",
    activeState: "Active",
    notes: "",
    overdue: false,
    dueNext14Days: false,
    sourceRow: 2,
    ...overrides,
  };
}

function exception(overrides = {}) {
  return {
    exceptionId: "EXC-1",
    severity: "High",
    reason: "Missing email",
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    recipientName: "Ava",
    shipDate: "2026-08-15",
    suggestedShipDate: "",
    status: "To Prepare",
    sourceRow: 2,
    ...overrides,
  };
}

function seedWith({ mailings = [], exceptions = [] } = {}) {
  return { subscribers: [], recipients: [], subscriptions: [], orders: [], mailings, exceptions, automationRules: [], summary: {} };
}

const TODAY = "2026-08-12";
const EMPTY_DRIVE_CONFIG = { printReadyFolderUrl: "", characterFolders: {}, envelopeFolders: {}, letterFolders: {} };

function baseCall(seed, overrides = {}) {
  return computePrintData(
    seed,
    overrides.statusOverrides ?? {},
    overrides.reviewed ?? new Set(),
    overrides.componentOverrides ?? {},
    overrides.batchFilter ?? "all",
    overrides.printScope ?? "all",
    overrides.printStockFilter ?? "all",
    overrides.query ?? "",
    TODAY,
    overrides.driveConfig ?? EMPTY_DRIVE_CONFIG,
  );
}

test("computePrintData only includes mailings whose envelope componentStatus is 'Need Print' - Printed/In Ashley Box rows drop off the list", () => {
  const needPrint = mailing({ mailingId: "MAIL-NEED" });
  const printed = mailing({ mailingId: "MAIL-PRINTED", sourceRow: 3 });
  const seed = seedWith({ mailings: [needPrint, printed] });
  const componentOverrides = { "MAIL-PRINTED::3::envelope": "Printed" };
  const data = baseCall(seed, { componentOverrides });
  assert.deepEqual(
    data.rows.map((row) => row.mailing.mailingId),
    ["MAIL-NEED"],
  );
});

test("computePrintData excludes archived, Mailed, and mailings with an active High exception", () => {
  const archived = mailing({ mailingId: "MAIL-ARCHIVED", activeState: "Archived" });
  const mailed = mailing({ mailingId: "MAIL-MAILED", status: "Mailed", sourceRow: 3 });
  const flagged = mailing({ mailingId: "MAIL-FLAGGED", sourceRow: 4 });
  const seed = seedWith({ mailings: [archived, mailed, flagged], exceptions: [exception({ mailingId: "MAIL-FLAGGED", severity: "High" })] });
  const data = baseCall(seed);
  assert.equal(data.rows.length, 0, "all three rows are excluded for their own reason");
});

test("computePrintData's printScope 'monthly' keeps only Month-to-month", () => {
  const monthly = mailing({ mailingId: "MAIL-MONTHLY", plan: "Month-to-month" });
  const prepaid = mailing({ mailingId: "MAIL-PREPAID", plan: "12-month", sourceRow: 3 });
  const seed = seedWith({ mailings: [monthly, prepaid] });
  // Force the prepaid row into "Need Print" explicitly (its own plan
  // defaults to "In Ashley Box" - see mailing()'s header comment) so this
  // test isolates the scope filter's own effect, rather than the prepaid
  // row already being absent for an unrelated reason.
  const componentOverrides = { "MAIL-PREPAID::3::envelope": "Need Print" };
  const data = baseCall(seed, { printScope: "monthly", componentOverrides });
  assert.deepEqual(
    data.rows.map((row) => row.mailing.mailingId),
    ["MAIL-MONTHLY"],
  );
});

test("computePrintData searches recipientName/email/character/plan/status/mailingId/orderId", () => {
  const item = mailing();
  const seed = seedWith({ mailings: [item] });
  for (const query of ["Ava Example", "ava@example.test", "Ringo", "Month-to-month", "To Prepare", "MAIL-1", "ORD-1"]) {
    assert.equal(baseCall(seed, { query }).rows.length, 1, `query "${query}" should match`);
  }
  assert.equal(baseCall(seed, { query: "zzz-no-match-zzz" }).rows.length, 0);
});

test("envelopeGroups bucket by envelope stock, computed from baseRows (before the stock filter, not after)", () => {
  const a = mailing({ mailingId: "MAIL-A", character: "Ringo", plan: "Month-to-month" });
  const b = mailing({ mailingId: "MAIL-B", character: "Ringo", plan: "12-month", sourceRow: 3 });
  const c = mailing({ mailingId: "MAIL-C", character: "Marley", plan: "12-month", sourceRow: 4 });
  const seed = seedWith({ mailings: [a, b, c] });
  // b and c are prepaid plans, whose own default envelope status is "In
  // Ashley Box" (not "Need Print") - force both into baseRows explicitly
  // so this test is actually exercising the stock grouping, not silently
  // relying on the Need-Print filter to have excluded them anyway.
  const componentOverrides = {
    "MAIL-B::3::envelope": "Need Print",
    "MAIL-C::4::envelope": "Need Print",
  };
  const data = baseCall(seed, { printStockFilter: "Marley color envelope", componentOverrides });
  // Even though the stock filter narrows `rows` to Marley only, the
  // groups themselves (and allStocksTotal) reflect every stock present
  // in baseRows, not just the currently-filtered one - that's what makes
  // the OTHER stock buttons still show their own real counts.
  assert.ok(data.envelopeGroups.length >= 2, "both Ringo and Marley stocks should appear as groups");
  assert.equal(
    data.rows.map((row) => row.mailing.mailingId).length,
    1,
    "rows itself is narrowed by the stock filter",
  );
});

test("an invalid printStockFilter (no longer matches any group) is silently corrected to 'all' - effectivePrintStockFilter, not the raw input, drives row filtering", () => {
  const m = mailing({ mailingId: "MAIL-1", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const data = baseCall(seed, { printStockFilter: "Some Stock That No Longer Exists" });
  assert.equal(data.effectivePrintStockFilter, "all");
  assert.equal(data.rows.length, 1, "the corrected filter is used for row filtering in the same call, not just returned for display");
});

test("a printStockFilter that still matches a real group is left alone", () => {
  const m = mailing({ mailingId: "MAIL-1", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const data = baseCall(seed, { printStockFilter: "all" });
  const realStock = data.envelopeGroups[0]?.label;
  assert.ok(realStock, "fixture invariant: at least one group should exist");
  const filtered = baseCall(seed, { printStockFilter: realStock });
  assert.equal(filtered.effectivePrintStockFilter, realStock);
  assert.equal(filtered.rows.length, 1);
});

test("each row's Drive-link fields reflect the threaded-in driveConfig - exact letter URL wins over the character fallback, and 'Needs Link'/'Needs envelope link' when neither is configured", () => {
  const m = mailing({ mailingId: "MAIL-1", character: "Ringo", letterNumber: "3" });
  const seed = seedWith({ mailings: [m] });
  const emptyResult = baseCall(seed).rows[0];
  assert.equal(emptyResult.envelopeState, "Needs envelope link");
  assert.equal(emptyResult.letterButtonLabel, "Needs Link");
  assert.equal(emptyResult.letterState, "Needs letter link");

  const driveConfig = {
    printReadyFolderUrl: "",
    characterFolders: { ringo: "https://drive.example/ringo" },
    envelopeFolders: { ringo: "https://drive.example/ringo-envelopes" },
    letterFolders: { ringo: { 3: "https://drive.example/ringo-letter-3" } },
  };
  const withLinks = baseCall(seed, { driveConfig }).rows[0];
  assert.equal(withLinks.envelopeUrl, "https://drive.example/ringo-envelopes");
  assert.equal(withLinks.envelopeState, "Character envelope folder");
  assert.equal(withLinks.letterUrl, "https://drive.example/ringo-letter-3");
  assert.equal(withLinks.letterButtonLabel, "Open Letter");
  assert.equal(withLinks.letterState, "Exact Letter 3");
});

test("a row's letterUrl falls back to the character folder when the exact letter isn't configured", () => {
  const m = mailing({ mailingId: "MAIL-1", character: "Ringo", letterNumber: "9" });
  const seed = seedWith({ mailings: [m] });
  const driveConfig = { printReadyFolderUrl: "", characterFolders: { ringo: "https://drive.example/ringo" }, envelopeFolders: {}, letterFolders: { ringo: { 3: "https://drive.example/ringo-letter-3" } } };
  const row = baseCall(seed, { driveConfig }).rows[0];
  assert.equal(row.letterUrl, "https://drive.example/ringo");
  assert.equal(row.letterButtonLabel, "Open Character");
  assert.equal(row.letterState, "Open character folder");
});

test("mode/notes reflect printModeForPlan - Prepaid bulk (6/12-month) vs. everything else", () => {
  const prepaid = mailing({ mailingId: "MAIL-PREPAID", plan: "12-month" });
  const monthly = mailing({ mailingId: "MAIL-MONTHLY", plan: "Month-to-month", sourceRow: 3 });
  const seed = seedWith({ mailings: [prepaid, monthly] });
  // prepaid's own default envelope status is "In Ashley Box" - force it
  // into "Need Print" so it actually reaches baseRows/rows and this test
  // can inspect its mode/notes.
  const componentOverrides = { "MAIL-PREPAID::2::envelope": "Need Print" };
  const rows = baseCall(seed, { componentOverrides }).rows;
  const prepaidRow = rows.find((row) => row.mailing.mailingId === "MAIL-PREPAID");
  const monthlyRow = rows.find((row) => row.mailing.mailingId === "MAIL-MONTHLY");
  assert.equal(prepaidRow.mode, "Prepaid bulk");
  assert.match(prepaidRow.notes, /printed\/prepared in advance/);
  assert.equal(monthlyRow.mode, "Month-to-month");
  assert.match(monthlyRow.notes, /Time-sensitive renewal/);
});

test("summary figures (monthToMonthCount/latestMonthlyOrderDate/envelopePieceCount/allStocksTotal) are derived from the right row set - monthToMonth/latest from the filtered rows, allStocksTotal from baseRows", () => {
  const monthly1 = mailing({ mailingId: "MAIL-M1", plan: "Month-to-month", orderDate: "2026-07-01" });
  const monthly2 = mailing({ mailingId: "MAIL-M2", plan: "Month-to-month", orderDate: "2026-08-01", sourceRow: 3 });
  const prepaid = mailing({ mailingId: "MAIL-P1", plan: "12-month", sourceRow: 4 });
  const seed = seedWith({ mailings: [monthly1, monthly2, prepaid] });
  // prepaid's own default envelope status is "In Ashley Box" - force it
  // into baseRows/rows so envelopePieceCount/allStocksTotal below reflect
  // all three mailings, not just the two Month-to-month ones.
  const componentOverrides = { "MAIL-P1::4::envelope": "Need Print" };
  const data = baseCall(seed, { componentOverrides });
  assert.equal(data.monthToMonthCount, 2);
  assert.equal(data.latestMonthlyOrderDate, "2026-08-01");
  assert.equal(data.envelopePieceCount, monthly1 && 2 + 2 + 1, "Month-to-month mailings need 2 envelopes each, prepaid needs 1");
  assert.equal(data.allStocksTotal, data.envelopePieceCount, "no stock filter applied here, so baseRows and filtered rows cover the same set");
});

test("computePrintData is deterministic given the same today - same inputs, same output, called twice", () => {
  const seed = seedWith({ mailings: [mailing(), mailing({ mailingId: "MAIL-2", orderId: "ORD-2", sourceRow: 3 })] });
  const a = baseCall(seed, { batchFilter: "next" });
  const b = baseCall(seed, { batchFilter: "next" });
  assert.deepEqual(a, b);
});
