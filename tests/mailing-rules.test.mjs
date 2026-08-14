import assert from "node:assert/strict";
import test from "node:test";
import {
  OPEN_STATUSES,
  isOpenStatus,
  todayIso,
  daysBetween,
  isOverdueMailing,
  isDueNext14Days,
  monthKey,
  nearestBatchDate,
} from "../lib/mailing-rules.ts";

// Format/behavior-locking tests, not parity tests - see tests/ids.test.mjs's
// module comment for why (same reasoning, same step 3a change:
// app/crm/legacy-app.js now imports lib/mailing-rules.ts directly instead
// of keeping mirrored copies of openStatuses/isOverdueMailing/
// isDueNext14Days/nearestBatchDate/daysBetween/todayIso).
//
// Every literal value below was captured by running the pre-refactor
// lib/mailing-rules.ts (byte-identical in behavior to app.js's own copies
// at the time) over these exact sample inputs, before any implementation
// code in this change was touched.

test("isOpenStatus/OPEN_STATUSES agree for every known status plus unknowns", () => {
  const samples = [
    ["To Prepare", true],
    ["Printing", true],
    ["Assembling", true],
    ["Ready to Mail", true],
    ["Mailed", false],
    ["", false],
    ["Needs Review", false],
    ["bogus", false],
  ];
  for (const [status, expected] of samples) {
    assert.equal(isOpenStatus(status), expected, `mismatch for status=${JSON.stringify(status)}`);
    assert.equal(OPEN_STATUSES.has(status), expected, `OPEN_STATUSES.has() disagrees for status=${JSON.stringify(status)}`);
  }
});

test("isOverdueMailing produces the documented result for sample data", () => {
  const today = "2026-08-12";
  const samples = [
    [{ activeState: "Active", status: "To Prepare", shipDate: "2026-08-01" }, true], // past, open -> overdue
    [{ activeState: "Active", status: "Mailed", shipDate: "2026-08-01" }, false], // past, not open -> not overdue
    [{ activeState: "Archived", status: "To Prepare", shipDate: "2026-08-01" }, false], // not active -> not overdue
    [{ activeState: "Active", status: "Printing", shipDate: "2026-08-12" }, false], // today, not < today -> not overdue
    [{ activeState: "Active", status: "Printing", shipDate: "" }, false], // no ship date -> not overdue
    [{ activeState: "Active", status: "Printing", shipDate: "2026-09-01" }, false], // future -> not overdue
  ];
  for (const [mailing, expected] of samples) {
    assert.equal(isOverdueMailing(mailing, today), expected, JSON.stringify(mailing));
  }
});

test("isDueNext14Days produces the documented result for sample data", () => {
  const today = "2026-08-12";
  const samples = [
    [{ activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-12" }, true], // today -> due
    [{ activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-26" }, true], // exactly 14 days -> due
    [{ activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-27" }, false], // 15 days -> not due
    [{ activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-01" }, false], // past -> not due
    [{ activeState: "Active", status: "Mailed", shipDate: "2026-08-15" }, false], // not open -> not due
    [{ activeState: "Archived", status: "Ready to Mail", shipDate: "2026-08-15" }, false], // not active -> not due
    [{ activeState: "Active", status: "Ready to Mail", shipDate: "" }, false], // no ship date -> not due
  ];
  for (const [mailing, expected] of samples) {
    assert.equal(isDueNext14Days(mailing, today), expected, JSON.stringify(mailing));
  }
});

test("nearestBatchDate produces the documented result for sample data", () => {
  const samples = [
    ["2026-08-01", "2026-08-01"],
    ["2026-08-15", "2026-08-15"],
    ["2026-08-03", "2026-08-01"],
    ["2026-08-08", "2026-08-15"],
    ["2026-08-14", "2026-08-15"],
    ["2026-08-16", "2026-08-15"],
    ["2026-08-22", "2026-08-15"],
    ["2026-08-23", "2026-09-01"],
    ["2026-08-31", "2026-10-01"],
    ["2026-02-28", "2026-03-01"],
    ["", ""],
    [null, ""],
  ];
  for (const [value, expected] of samples) {
    assert.equal(nearestBatchDate(value), expected, `mismatch for ${JSON.stringify(value)}`);
  }
});

test("daysBetween produces the documented result for sample data", () => {
  const samples = [
    [["2026-08-12", "2026-08-12"], 0],
    [["2026-08-12", "2026-08-26"], 14],
    [["2026-08-26", "2026-08-12"], -14],
    [["2026-01-01", "2026-12-31"], 364],
  ];
  for (const [[a, b], expected] of samples) {
    assert.equal(daysBetween(a, b), expected, `mismatch for ${a}, ${b}`);
  }
});

test("monthKey produces the documented result for sample data", () => {
  const samples = [
    ["2026-08-12", "2026-08"],
    ["2026-01-01", "2026-01"],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ];
  for (const [value, expected] of samples) {
    assert.equal(monthKey(value), expected, `mismatch for ${JSON.stringify(value)}`);
  }
});

test("todayIso produces the local calendar date for a fixed instant", () => {
  // UTC noon, not an arbitrary instant: todayIso() converts to the LOCAL
  // calendar date, so the expected literal below is only TZ-stable if the
  // chosen instant doesn't cross a date boundary once shifted by the
  // runtime's own offset. Noon UTC leaves roughly 12 hours of headroom on
  // both sides, safe for every realistic runtime TZ including the
  // TZ=Asia/Tokyo (UTC+9) this suite is explicitly verified under - same
  // reasoning tests/render-snapshots.test.mjs's FIXED_NOW uses, and the same
  // UTC+13/+14 caveat applies (not a realistic developer/CI timezone).
  const fixedNow = new Date("2026-08-12T12:00:00.000Z");
  assert.equal(todayIso(fixedNow), "2026-08-12");
});
