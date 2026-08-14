import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlan, plannedLetterCount, printModeForPlan, envelopeQuantityForMailing, numericLetter } from "../lib/domain/plans.ts";

// New coverage from step 3b's extraction (lib/domain/plans.ts didn't exist
// before this) - not a re-assertion of what the render snapshots already
// cover, per that task's explicit instruction to exercise the branches
// these functions actually have.

test("normalizePlan recognizes exact plan phrasing", () => {
  assert.equal(normalizePlan("Month-to-month"), "Month-to-month");
  assert.equal(normalizePlan("6-month"), "6-month");
  assert.equal(normalizePlan("12-month"), "12-month");
  assert.equal(normalizePlan("One-time"), "One-time");
});

test("normalizePlan recognizes loose spreadsheet phrasing", () => {
  assert.equal(normalizePlan("12 Month Plan"), "12-month");
  assert.equal(normalizePlan("6 Month"), "6-month");
  assert.equal(normalizePlan("Monthly Renewal"), "Month-to-month");
  assert.equal(normalizePlan("Sample"), "One-time");
});

test("normalizePlan handles digit-form input (\"1 time\"/\"1-time\") as One-time", () => {
  // Regression case: PR #12 in this repo's history fixed normalizePlan()
  // to recognize digit-form "1 time"/"1-time" as One-time, not just the
  // word "one". Locking that fix's exact behavior here.
  assert.equal(normalizePlan("1 time"), "One-time");
  assert.equal(normalizePlan("1-time"), "One-time");
});

test("normalizePlan checks '12' before '6' before 'month'/'renewal' before 'one'/'sample'/digit-'1' - order matters for ambiguous input", () => {
  // Real branch-order dependency, not a hidden bug: a string satisfying
  // more than one check is claimed by whichever check runs first.
  // "612-month" contains "12", "6", and "month" all at once - the "12"
  // check (first) wins.
  assert.equal(normalizePlan("612-month"), "12-month", "contains '12', '6', and 'month' - the '12' check runs first and wins");
});

test("normalizePlan falls back to 'Needs Review' for blank input, and to the raw trimmed string for unrecognized non-blank input", () => {
  assert.equal(normalizePlan(""), "Needs Review");
  assert.equal(normalizePlan(null), "Needs Review");
  assert.equal(normalizePlan(undefined), "Needs Review");
  assert.equal(normalizePlan("  "), "Needs Review");
  assert.equal(normalizePlan("Bespoke Arrangement"), "Bespoke Arrangement");
});

test("plannedLetterCount maps each metered plan, defaulting everything else to 1", () => {
  assert.equal(plannedLetterCount("Month-to-month"), 2);
  assert.equal(plannedLetterCount("6-month"), 12);
  assert.equal(plannedLetterCount("12-month"), 24);
  assert.equal(plannedLetterCount("One-time"), 1);
  assert.equal(plannedLetterCount("Needs Review"), 1);
  assert.equal(plannedLetterCount("anything else"), 1);
});

test("printModeForPlan groups 6/12-month as Prepaid bulk, keeps Month-to-month distinct, and defaults everything else to Special", () => {
  assert.equal(printModeForPlan("Month-to-month"), "Month-to-month");
  assert.equal(printModeForPlan("6-month"), "Prepaid bulk");
  assert.equal(printModeForPlan("12-month"), "Prepaid bulk");
  assert.equal(printModeForPlan("One-time"), "Special");
  assert.equal(printModeForPlan("Needs Review"), "Special");
});

test("envelopeQuantityForMailing is 2 for Month-to-month, 1 for every other plan", () => {
  assert.equal(envelopeQuantityForMailing({ plan: "Month-to-month" }), 2);
  assert.equal(envelopeQuantityForMailing({ plan: "6-month" }), 1);
  assert.equal(envelopeQuantityForMailing({ plan: "12-month" }), 1);
  assert.equal(envelopeQuantityForMailing({ plan: "One-time" }), 1);
});

test("numericLetter parses a real number, defaulting to 0 for anything non-numeric", () => {
  assert.equal(numericLetter("3"), 3);
  assert.equal(numericLetter(7), 7);
  assert.equal(numericLetter(""), 0);
  assert.equal(numericLetter(null), 0);
  assert.equal(numericLetter(undefined), 0);
  assert.equal(numericLetter("not a number"), 0);
});
