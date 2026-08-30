import assert from "node:assert/strict";
import test from "node:test";
import { spreadsheetExceptionReasons, duplicateMailingFlags, explicitExceptionSeverity, DUPLICATE_MAILING_SEVERITY } from "../lib/domain/spreadsheet/exceptions.ts";

// New coverage from step 3c (lib/domain/spreadsheet/exceptions.ts shipped
// in step 3b with no direct unit tests - only indirectly covered via the
// snapshot suite and the e2e discrepancy count). All expected values below
// were captured by actually running the (unchanged) implementation, not
// hand-computed - including the severity-classifier finding below, which
// corrects a stated premise rather than confirming it.
//
// severity itself isn't computed in this module - build-seed.ts computes
// it from the returned reasons array via
// `reasons.some((r) => r.includes('Missing') || r.includes('ship date')) ?
// 'High' : 'Low'`. That expression is duplicated here deliberately (not
// imported - it's a two-line inline expression in build-seed.ts, not an
// exported function) so these tests can verify severity end to end
// against this module's real output.
const classifySeverity = (reasons) => (reasons.some((r) => explicitExceptionSeverity(r) === "High" || r.includes("Missing") || r.includes("ship date")) ? "High" : "Low");

const CLEAN_ROW = {
  recipientName: "Jane Doe",
  address: "1 Main St",
  email: "jane@example.test",
  character: "Marley",
  plan: "Month-to-month",
  shipDate: "2026-08-15",
  status: "To Prepare",
};
const TODAY = "2026-08-01";

test("spreadsheetExceptionReasons returns no reasons for a fully clean row", () => {
  assert.deepEqual(spreadsheetExceptionReasons(CLEAN_ROW, "Active", TODAY), []);
});

test("spreadsheetExceptionReasons flags a missing or 'Unknown recipient' recipientName", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, recipientName: "" }, "Active", TODAY), ["Missing recipient"]);
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, recipientName: "Unknown recipient" }, "Active", TODAY), ["Missing recipient"]);
});

test("spreadsheetExceptionReasons flags a missing address", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, address: "" }, "Active", TODAY), ["Missing address"]);
});

test("spreadsheetExceptionReasons flags a missing email", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, email: "" }, "Active", TODAY), ["Missing email"]);
});

test("spreadsheetExceptionReasons flags a missing or 'Needs Review' character", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, character: "" }, "Active", TODAY), ["Missing character"]);
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, character: "Needs Review" }, "Active", TODAY), ["Missing character"]);
});

test("spreadsheetExceptionReasons flags a missing or 'Needs Review' plan as 'Missing subscription'", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, plan: "" }, "Active", TODAY), ["Missing subscription"]);
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, plan: "Needs Review" }, "Active", TODAY), ["Missing subscription"]);
});

test("spreadsheetExceptionReasons flags a missing ship date", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, shipDate: "" }, "Active", TODAY), ["Missing ship date"]);
});

test("spreadsheetExceptionReasons flags a ship date that isn't the 1st or 15th", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, shipDate: "2026-08-20" }, "Active", TODAY), ["Ship date is not a 1st/15th batch"]);
});

test("spreadsheetExceptionReasons does not flag the 1st or the 15th as an off-batch date", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, shipDate: "2026-08-01" }, "Active", TODAY), []);
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, shipDate: "2026-08-15" }, "Active", TODAY), []);
});

test("spreadsheetExceptionReasons flags a Mailed row whose ship date is still in the future, only when Active", () => {
  const futureMailed = { ...CLEAN_ROW, status: "Mailed", shipDate: "2026-09-01" };
  assert.deepEqual(spreadsheetExceptionReasons(futureMailed, "Active", TODAY), ["Future mailing already marked mailed"]);
  assert.deepEqual(spreadsheetExceptionReasons(futureMailed, "Archived", TODAY), [], "Archived rows never get this check, regardless of status/shipDate");
});

test("spreadsheetExceptionReasons does not flag a Mailed row whose ship date has already passed", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, status: "Mailed", shipDate: "2026-07-01" }, "Active", TODAY), []);
});

test("spreadsheetExceptionReasons does not flag a future ship date for a status other than Mailed", () => {
  assert.deepEqual(spreadsheetExceptionReasons({ ...CLEAN_ROW, status: "To Prepare", shipDate: "2026-09-01" }, "Active", TODAY), []);
});

test("spreadsheetExceptionReasons combines multiple simultaneous problems into one array", () => {
  const brokenRow = { ...CLEAN_ROW, recipientName: "", address: "", email: "" };
  assert.deepEqual(spreadsheetExceptionReasons(brokenRow, "Active", TODAY), ["Missing recipient", "Missing address", "Missing email"]);
});

test("spreadsheetExceptionReasons combines every possible reason when everything is wrong at once", () => {
  const everythingWrong = { recipientName: "", address: "", email: "", character: "", plan: "", shipDate: "", status: "" };
  assert.deepEqual(spreadsheetExceptionReasons(everythingWrong, "Active", TODAY), [
    "Missing recipient",
    "Missing address",
    "Missing email",
    "Missing character",
    "Missing subscription",
    "Missing ship date",
  ]);
});

test("severity classifier: every 'Missing *' reason and 'Missing ship date' classify as High", () => {
  for (const field of ["recipientName", "address", "email", "character", "plan", "shipDate"]) {
    const reasons = spreadsheetExceptionReasons({ ...CLEAN_ROW, [field]: "" }, "Active", TODAY);
    assert.equal(classifySeverity(reasons), "High", `field=${field}, reasons=${JSON.stringify(reasons)}`);
  }
});

// This corrects the premise this test file was requested under (that
// "Ship date is not a 1st/15th batch" is the only reason classifying as
// Low): verified directly against the real classifier expression, above,
// that "Future mailing already marked mailed" also contains neither
// "Missing" nor "ship date" (lowercase - the reason is "...already marked
// mailed", not "...ship date..."), so it also classifies Low whenever it's
// the only reason present. There are two Low-eligible reasons, not one.
test("severity classifier: unusual ship dates are High so mailing work stops until reviewed", () => {
  const offBatch = spreadsheetExceptionReasons({ ...CLEAN_ROW, shipDate: "2026-08-20" }, "Active", TODAY);
  assert.deepEqual(offBatch, ["Ship date is not a 1st/15th batch"]);
  assert.equal(classifySeverity(offBatch), "High");

  const futureMailed = spreadsheetExceptionReasons({ ...CLEAN_ROW, status: "Mailed", shipDate: "2026-09-01" }, "Active", TODAY);
  assert.deepEqual(futureMailed, ["Future mailing already marked mailed"]);
  assert.equal(classifySeverity(futureMailed), "High");
});

test("severity classifier: a single 'Missing' reason bumps the whole exception to High even combined with a Low-eligible reason", () => {
  // Off-batch ship date (Low-eligible on its own) combined with a missing
  // character (High) - the exception's overall severity is computed once
  // via reasons.some(...), so one High-eligible reason in the array is
  // enough to make the whole exception High, regardless of what else is
  // also wrong.
  const reasons = spreadsheetExceptionReasons({ ...CLEAN_ROW, character: "", shipDate: "2026-08-20" }, "Active", TODAY);
  assert.deepEqual(reasons, ["Missing character", "Ship date is not a 1st/15th batch"]);
  assert.equal(classifySeverity(reasons), "High");
});

// duplicateMailingFlags() - the cross-row half of exception detection. Pins
// the real fixture shape: rows 309/310/311 all sharing order 2858 +
// character Marley + letter number 4 (see project memory
// project_import_skip_reporting.md - the ORD-2858 case is 3 rows, not 2).

function mailing(sourceRow, overrides = {}) {
  return { sourceRow, mailingId: `MAIL-${sourceRow}`, orderId: "ORD-2858", character: "Marley", letterNumber: "4", ...overrides };
}

test("duplicateMailingFlags flags every row in a 3-way collision, each naming the OTHER two rows", () => {
  const rows = [mailing(309), mailing(310), mailing(311)];
  const flags = duplicateMailingFlags(rows);
  assert.equal(flags.length, 3, "one flag per colliding row, not one per group");

  const bySourceRow = new Map(flags.map((f) => [f.mailing.sourceRow, f.reason]));
  assert.equal(bySourceRow.get(309), "Duplicate: shares order, character, and letter number with rows 310, 311");
  assert.equal(bySourceRow.get(310), "Duplicate: shares order, character, and letter number with rows 309, 311");
  assert.equal(bySourceRow.get(311), "Duplicate: shares order, character, and letter number with rows 309, 310");
});

test("duplicateMailingFlags uses singular 'row' when only one other row collides", () => {
  const rows = [mailing(309), mailing(310)];
  const flags = duplicateMailingFlags(rows);
  assert.equal(flags.length, 2);
  assert.equal(flags.find((f) => f.mailing.sourceRow === 309).reason, "Duplicate: shares order, character, and letter number with row 310");
});

test("duplicateMailingFlags flags nothing when no rows collide", () => {
  const rows = [mailing(309), mailing(310, { letterNumber: "5" }), mailing(311, { character: "Piper" }), mailing(312, { orderId: "ORD-9999" })];
  assert.deepEqual(duplicateMailingFlags(rows), []);
});

test("duplicateMailingFlags treats two rows both missing a letter number as colliding too - genuine, irreducible ambiguity, not something to guess through", () => {
  const rows = [mailing(309, { letterNumber: "" }), mailing(310, { letterNumber: null })];
  const flags = duplicateMailingFlags(rows);
  assert.equal(flags.length, 2);
});

// Severity: an explicit, stated choice (not derived from reason text) -
// pinned so a future edit has to change this test deliberately, not
// silently inherit a different severity from word choice the way the
// substring classifier above traps for other reasons.
test("DUPLICATE_MAILING_SEVERITY is High", () => {
  assert.equal(DUPLICATE_MAILING_SEVERITY, "High");
});

test("explicitExceptionSeverity recognizes a 'Duplicate:'-prefixed reason regardless of which rows it names", () => {
  assert.equal(explicitExceptionSeverity("Duplicate: shares order, character, and letter number with rows 310, 311"), "High");
  assert.equal(explicitExceptionSeverity("Duplicate: shares order, character, and letter number with row 42"), "High");
});

test("explicitExceptionSeverity makes unusual ship dates and new customer risks High", () => {
  for (const reason of ["Ship date is not a 1st/15th batch", "Future mailing already marked mailed", "Possible duplicate customer: example", "Overlapping subscriptions: example", "Duplicate letter number: example", "Letter sequence out of sync: example"]) {
    assert.equal(explicitExceptionSeverity(reason), "High", reason);
  }
  for (const reason of ["Missing recipient", "Missing address", "Missing ship date"]) {
    assert.equal(explicitExceptionSeverity(reason), null, reason);
  }
});
