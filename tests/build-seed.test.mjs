import assert from "node:assert/strict";
import test from "node:test";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";

// Smoke coverage only - deliberately not an elaborate fixture.
// buildSeedFromSpreadsheet's real coverage comes from
// tests/render-snapshots.test.mjs's 11-row synthetic fixture and
// tests/build-dataset-from-tables.e2e.test.mjs's real 1,218-row diff
// against the server reconstruction, neither of which a hand-built unit
// fixture would beat. This just confirms the now-pure function (no
// sandbox needed - it's a plain import) runs end to end and threads
// now/automationRules correctly, now that step 3c made both real
// parameters instead of internal reads.

const ROW = {
  "Order ID": "5001",
  "Original Order Date": "2026-07-01",
  "Customer Name and Address": "Ava Example\n1 Main St, Sample City, ZZ 00000",
  "Character": "Marley",
  "Letter Number": "1",
  "Ship Date": "2026-08-15",
  "Subscription": "Month-to-month",
  "Status": "To Prepare",
  "Active?": "Yes",
  "Email": "ava@example.test",
};
const NOW = new Date("2026-08-01T12:00:00.000Z");

test("buildSeedFromSpreadsheet parses a single clean row into one of each entity", () => {
  const dataset = buildSeedFromSpreadsheet([ROW], "smoke.xlsx", NOW, []);
  assert.equal(dataset.subscribers.length, 1);
  assert.equal(dataset.recipients.length, 1);
  assert.equal(dataset.orders.length, 1);
  assert.equal(dataset.subscriptions.length, 1);
  assert.equal(dataset.mailings.length, 1);
  assert.equal(dataset.exceptions.length, 0);
  assert.equal(dataset.mailings[0].character, "Marley");
  assert.equal(dataset.mailings[0].shipDate, "2026-08-15");
});

test("buildSeedFromSpreadsheet threads `now` into summary.asOf via todayIso, not the live clock", () => {
  const dataset = buildSeedFromSpreadsheet([ROW], "smoke.xlsx", NOW, []);
  assert.equal(dataset.summary.asOf, "2026-08-01");
});

test("buildSeedFromSpreadsheet threads `automationRules` straight through to the returned dataset", () => {
  const rules = [{ rule: "Mailing cadence", logic: "1st and 15th." }];
  const dataset = buildSeedFromSpreadsheet([ROW], "smoke.xlsx", NOW, rules);
  assert.deepEqual(dataset.automationRules, rules);
});

test("buildSeedFromSpreadsheet flags a broken row as an exception instead of throwing", () => {
  const brokenRow = { ...ROW, "Character": "", "Ship Date": "" };
  const dataset = buildSeedFromSpreadsheet([brokenRow], "smoke.xlsx", NOW, []);
  assert.equal(dataset.exceptions.length, 1);
  assert.equal(dataset.exceptions[0].reason, "Missing character; Missing ship date");
  assert.equal(dataset.exceptions[0].severity, "High");
});

// Cross-row duplicate detection - the same order+character+letterNumber
// collision lib/write-to-tables.ts's writeImport() drops rather than
// guessing through (lib/domain/mailing-collision.ts). Mirrors the real
// fixture shape (rows 309/310/311, order 2858, character Marley, letter
// number 4 - see project memory project_import_skip_reporting.md), scaled
// down to 2 rows for a focused unit fixture.

test("buildSeedFromSpreadsheet flags two otherwise-clean colliding rows as duplicates, one exception per row, each naming the other, High severity", () => {
  const rowA = { ...ROW, "Ship Date": "2026-08-15" };
  const rowB = { ...ROW, "Ship Date": "2026-09-01" };
  const dataset = buildSeedFromSpreadsheet([rowA, rowB], "smoke.xlsx", NOW, []);

  assert.equal(dataset.mailings.length, 2, "duplicate detection is reporting-only - both mailings still get written to the seed");
  assert.equal(dataset.exceptions.length, 2);

  const bySourceRow = new Map(dataset.exceptions.map((e) => [e.sourceRow, e]));
  assert.equal(bySourceRow.get(2).reason, "Duplicate: shares order, character, and letter number with row 3; Duplicate letter number: letter 1 appears more than once in this subscription");
  assert.equal(bySourceRow.get(2).severity, "High");
  assert.equal(bySourceRow.get(3).reason, "Duplicate: shares order, character, and letter number with row 2; Duplicate letter number: letter 1 appears more than once in this subscription");
  assert.equal(bySourceRow.get(3).severity, "High");

  assert.equal(dataset.subscribers[0].issueCount, 2, "both colliding rows count toward the shared subscriber's issueCount");
});

test("buildSeedFromSpreadsheet escalates an existing per-row exception into a duplicate instead of creating a second exception for the same row", () => {
  // rowA has its own per-row problem (off-batch ship date - Low on its
  // own) AND collides with rowB on order+character+letterNumber. The
  // merge pass must append to rowA's existing exception object, not push
  // a second one for the same mailing - the normalized exceptions table
  // only ever holds one row per mailing_id (lib/write-to-tables.ts).
  const rowA = { ...ROW, "Ship Date": "2026-08-20" }; // off-batch: Low-eligible on its own
  const rowB = { ...ROW, "Ship Date": "2026-09-01" }; // otherwise clean
  const dataset = buildSeedFromSpreadsheet([rowA, rowB], "smoke.xlsx", NOW, []);

  assert.equal(dataset.exceptions.length, 2, "one exception per row, not one merged row plus a second new one");

  const bySourceRow = new Map(dataset.exceptions.map((e) => [e.sourceRow, e]));
  const rowAException = bySourceRow.get(2);
  assert.equal(rowAException.reason, "Ship date is not a 1st/15th batch; Duplicate: shares order, character, and letter number with row 3; Duplicate letter number: letter 1 appears more than once in this subscription");
  assert.equal(rowAException.severity, "High", "escalated from Low to High by the duplicate flag");

  const rowBException = bySourceRow.get(3);
  assert.equal(rowBException.reason, "Duplicate: shares order, character, and letter number with row 2; Duplicate letter number: letter 1 appears more than once in this subscription");
  assert.equal(rowBException.severity, "High");

  assert.equal(dataset.subscribers[0].issueCount, 2, "rowA's issueCount was already counted by the per-row pass; only rowB's new exception adds one more");
});

test("buildSeedFromSpreadsheet does not flag duplicates for rows that don't actually collide (different letter numbers)", () => {
  const rowA = { ...ROW, "Letter Number": "1" };
  const rowB = { ...ROW, "Letter Number": "2" };
  const dataset = buildSeedFromSpreadsheet([rowA, rowB], "smoke.xlsx", NOW, []);
  assert.equal(dataset.exceptions.length, 0);
});

test("buildSeedFromSpreadsheet flags possible duplicate customers sharing a name and address under different emails", () => {
  const rowA = { ...ROW, "Order ID": "6001", "Email": "ava.one@example.test", "Character": "Marley" };
  const rowB = { ...ROW, "Order ID": "6002", "Email": "ava.two@example.test", "Character": "Ringo", "Ship Date": "2026-09-01" };
  const dataset = buildSeedFromSpreadsheet([rowA, rowB], "smoke.xlsx", NOW, []);
  assert.equal(dataset.exceptions.length, 2);
  assert.ok(dataset.exceptions.every((item) => item.severity === "High"));
  assert.ok(dataset.exceptions.every((item) => item.reason.startsWith("Possible duplicate customer:")));
});

test("buildSeedFromSpreadsheet flags multiple active plans for the same customer, recipient, and character", () => {
  const rowA = { ...ROW, "Order ID": "7001", "Subscription": "Month-to-month", "Letter Number": "1" };
  const rowB = { ...ROW, "Order ID": "7002", "Subscription": "6-month", "Letter Number": "2", "Ship Date": "2026-09-01" };
  const dataset = buildSeedFromSpreadsheet([rowA, rowB], "smoke.xlsx", NOW, []);
  assert.equal(dataset.exceptions.length, 2);
  assert.ok(dataset.exceptions.every((item) => item.severity === "High"));
  assert.ok(dataset.exceptions.every((item) => item.reason.startsWith("Overlapping subscriptions:")));
});

test("buildSeedFromSpreadsheet does not flag consecutive subscriptions whose dates do not overlap", () => {
  const rowA = { ...ROW, "Order ID": "7101", "Original Order Date": "2026-01-01", "End Date": "2026-06-30", "Subscription": "6-month", "Letter Number": "1" };
  const rowB = { ...ROW, "Order ID": "7102", "Original Order Date": "2026-07-01", "Subscription": "12-month", "Letter Number": "2", "Ship Date": "2026-09-01" };
  const dataset = buildSeedFromSpreadsheet([rowA, rowB], "smoke.xlsx", NOW, []);
  assert.equal(dataset.exceptions.length, 0);
});

test("buildSeedFromSpreadsheet flags duplicate letter numbers within one subscription", () => {
  const rowA = { ...ROW, "Order ID": "7201", "Letter Number": "3", "Ship Date": "2026-08-15" };
  const rowB = { ...ROW, "Order ID": "7202", "Letter Number": "3", "Ship Date": "2026-09-01" };
  const dataset = buildSeedFromSpreadsheet([rowA, rowB], "smoke.xlsx", NOW, []);
  assert.equal(dataset.exceptions.length, 2);
  assert.ok(dataset.exceptions.every((item) => item.reason.startsWith("Duplicate letter number:")));
  assert.ok(dataset.exceptions.every((item) => item.severity === "High"));
});

test("buildSeedFromSpreadsheet flags skipped or backwards letter numbers by ship date", () => {
  const rows = [
    { ...ROW, "Order ID": "7301", "Letter Number": "2", "Ship Date": "2026-08-15" },
    { ...ROW, "Order ID": "7302", "Letter Number": "4", "Ship Date": "2026-09-01" },
    { ...ROW, "Order ID": "7303", "Letter Number": "3", "Ship Date": "2026-09-15" },
  ];
  const dataset = buildSeedFromSpreadsheet(rows, "smoke.xlsx", NOW, []);
  const risks = dataset.exceptions.filter((item) => item.reason.includes("Letter sequence out of sync:"));
  assert.equal(risks.length, 2);
  assert.ok(risks.every((item) => item.severity === "High"));
});
