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
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// Runs the real app/crm/legacy-app.js so its actual
// isOpenStatus/isOverdueMailing/isDueNext14Days/nearestBatchDate/
// daysBetween/todayIso/monthKey functions can be called directly -
// lib/mailing-rules.ts is only trustworthy as a spec if it's verified
// against the real thing. Same loadAppJsSandbox() as tests/ids.test.mjs and
// tests/keys.test.mjs - see its own comment in tests/e2e-helpers.mjs,
// including what passing fixedNow does (needed below since app.js's
// todayIso() hardcodes `new Date()` with no way to inject "now" directly).
const appJs = await loadAppJsSandbox();

test("app.js sandbox actually exposes the real mailing-rules functions (sanity check)", () => {
  assert.equal(typeof appJs.isOpenStatus, "function");
  assert.equal(typeof appJs.isOverdueMailing, "function");
  assert.equal(typeof appJs.isDueNext14Days, "function");
  assert.equal(typeof appJs.nearestBatchDate, "function");
  assert.equal(typeof appJs.daysBetween, "function");
  assert.equal(typeof appJs.todayIso, "function");
  assert.equal(typeof appJs.monthKey, "function");
});

test("OPEN_STATUSES matches app.js's real isOpenStatus for every known status plus unknowns", () => {
  const candidates = ["To Prepare", "Printing", "Assembling", "Ready to Mail", "Mailed", "", "Needs Review", "bogus"];
  for (const status of candidates) {
    assert.equal(isOpenStatus(status), appJs.isOpenStatus(status), `mismatch for status=${JSON.stringify(status)}`);
    assert.equal(OPEN_STATUSES.has(status), appJs.isOpenStatus(status), `OPEN_STATUSES.has() disagrees with app.js for status=${JSON.stringify(status)}`);
  }
});

test("isOverdueMailing matches app.js's real isOverdueMailing for sample data", () => {
  const today = "2026-08-12";
  const samples = [
    { activeState: "Active", status: "To Prepare", shipDate: "2026-08-01" }, // past, open -> overdue
    { activeState: "Active", status: "Mailed", shipDate: "2026-08-01" }, // past, not open -> not overdue
    { activeState: "Archived", status: "To Prepare", shipDate: "2026-08-01" }, // not active -> not overdue
    { activeState: "Active", status: "Printing", shipDate: "2026-08-12" }, // today, not < today -> not overdue
    { activeState: "Active", status: "Printing", shipDate: "" }, // no ship date -> not overdue
    { activeState: "Active", status: "Printing", shipDate: "2026-09-01" }, // future -> not overdue
  ];
  for (const mailing of samples) {
    assert.equal(isOverdueMailing(mailing, today), appJs.isOverdueMailing(mailing, today), JSON.stringify(mailing));
  }
});

test("isDueNext14Days matches app.js's real isDueNext14Days for sample data", () => {
  const today = "2026-08-12";
  const samples = [
    { activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-12" }, // today -> due
    { activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-26" }, // exactly 14 days -> due
    { activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-27" }, // 15 days -> not due
    { activeState: "Active", status: "Ready to Mail", shipDate: "2026-08-01" }, // past -> not due
    { activeState: "Active", status: "Mailed", shipDate: "2026-08-15" }, // not open -> not due
    { activeState: "Archived", status: "Ready to Mail", shipDate: "2026-08-15" }, // not active -> not due
    { activeState: "Active", status: "Ready to Mail", shipDate: "" }, // no ship date -> not due
  ];
  for (const mailing of samples) {
    assert.equal(isDueNext14Days(mailing, today), appJs.isDueNext14Days(mailing, today), JSON.stringify(mailing));
  }
});

test("nearestBatchDate matches app.js's real nearestBatchDate for sample data", () => {
  const samples = ["2026-08-01", "2026-08-15", "2026-08-03", "2026-08-08", "2026-08-14", "2026-08-16", "2026-08-22", "2026-08-23", "2026-08-31", "2026-02-28", "", null];
  for (const value of samples) {
    assert.equal(nearestBatchDate(value), appJs.nearestBatchDate(value), `mismatch for ${JSON.stringify(value)}`);
  }
});

test("daysBetween matches app.js's real daysBetween for sample data", () => {
  const samples = [
    ["2026-08-12", "2026-08-12"],
    ["2026-08-12", "2026-08-26"],
    ["2026-08-26", "2026-08-12"],
    ["2026-01-01", "2026-12-31"],
  ];
  for (const [a, b] of samples) {
    assert.equal(daysBetween(a, b), appJs.daysBetween(a, b), `mismatch for ${a}, ${b}`);
  }
});

test("monthKey matches app.js's real monthKey for sample data", () => {
  const samples = ["2026-08-12", "2026-01-01", "", null, undefined];
  for (const value of samples) {
    assert.equal(monthKey(value), appJs.monthKey(value), `mismatch for ${JSON.stringify(value)}`);
  }
});

test("todayIso matches app.js's real todayIso() when app.js's Date is frozen to the same instant", async () => {
  const fixedNow = new Date("2026-08-12T15:30:00.000Z");
  const frozenAppJs = await loadAppJsSandbox(fixedNow);
  assert.equal(todayIso(fixedNow), frozenAppJs.todayIso());
});
