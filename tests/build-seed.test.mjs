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
