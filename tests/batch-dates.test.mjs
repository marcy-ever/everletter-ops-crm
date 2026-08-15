import assert from "node:assert/strict";
import test from "node:test";
import { batchDatesForOrder, storageBinForMailing } from "../lib/domain/batch-dates.ts";

// New coverage from step 3b's extraction (lib/domain/batch-dates.ts didn't
// exist before this) - not a re-assertion of what the render snapshots
// already cover. All expected values below were captured by actually
// running the (unchanged) implementation, not hand-computed.
// storageBinForMailing added in step 3c, when it moved here from
// app/crm/legacy-app.js.

test("batchDatesForOrder walks forward from the order date, collecting the requested count of 1st/15th dates", () => {
  assert.deepEqual(batchDatesForOrder("2026-07-01", 4), ["2026-07-15", "2026-08-01", "2026-08-15", "2026-09-01"]);
});

test("batchDatesForOrder respects the 3-day cutoff: exactly 3 days out is included", () => {
  assert.deepEqual(batchDatesForOrder("2026-08-12", 1), ["2026-08-15"]);
});

test("batchDatesForOrder respects the 3-day cutoff: exactly 2 days out is excluded, rolling to the next batch date", () => {
  assert.deepEqual(batchDatesForOrder("2026-08-13", 1), ["2026-09-01"]);
});

test("batchDatesForOrder crosses a month boundary when the order date is late in the month", () => {
  assert.deepEqual(batchDatesForOrder("2026-08-27", 2), ["2026-09-01", "2026-09-15"]);
});

test("batchDatesForOrder returns exactly `count` dates, no more no less", () => {
  assert.equal(batchDatesForOrder("2026-01-01", 24).length, 24);
  assert.equal(batchDatesForOrder("2026-01-01", 12).length, 12);
  assert.equal(batchDatesForOrder("2026-01-01", 2).length, 2);
});

test("storageBinForMailing groups a mailing into Ashley's bin by ship date", () => {
  assert.equal(storageBinForMailing({ shipDate: "2026-08-15" }), "Ashley / Aug 15, 2026 bin");
});

test("storageBinForMailing returns 'Needs date' for a mailing with no ship date to group by yet", () => {
  assert.equal(storageBinForMailing({ shipDate: "" }), "Needs date");
});
