// Coverage for app/crm/views/qa/qa-selectors.ts - Phase 1 step 14
// (CLAUDE.md), the densest write surface in the app. Exercises the full
// filter/derivation chain computeQaData() reproduces from renderQa()/
// qaRow(): active/status/printScope/search filters, the high-exception
// sort priority, the 180-row cap, and the per-row enrichment
// (fieldValues, isReady/needsAttention, flags) every other selector test
// in this repo didn't need because no other migrated view bakes seven
// component-status lookups into its row shape at once.
import assert from "node:assert/strict";
import test from "node:test";
import { computeQaData, printedEnvelopeStatusForMailing, QA_FIELDS } from "../app/crm/views/qa/qa-selectors.ts";

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
    plan: "12-month",
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
const NO_LETTER_FOLDER = () => "";
const HAS_LETTER_FOLDER = () => "https://drive.example/letters/ringo/1";

test("computeQaData excludes archived and already-Mailed mailings", () => {
  const seed = seedWith({
    mailings: [
      mailing({ mailingId: "MAIL-ACTIVE", activeState: "Active", status: "To Prepare" }),
      mailing({ mailingId: "MAIL-ARCHIVED", activeState: "Archived" }),
      mailing({ mailingId: "MAIL-MAILED", status: "Mailed" }),
    ],
  });
  const { rows } = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.deepEqual(
    rows.map((row) => row.mailing.mailingId),
    ["MAIL-ACTIVE"],
  );
});

test("computeQaData's printScope 'monthly' keeps only Month-to-month, any other scope keeps every plan", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-MONTHLY", plan: "Month-to-month" }), mailing({ mailingId: "MAIL-PREPAID", plan: "12-month" })],
  });
  const monthly = computeQaData(seed, {}, new Set(), {}, "all", "monthly", "", TODAY, NO_LETTER_FOLDER).rows;
  assert.deepEqual(
    monthly.map((row) => row.mailing.mailingId),
    ["MAIL-MONTHLY"],
  );
  const all = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER).rows;
  assert.equal(all.length, 2);
});

test("computeQaData searches recipientName/email/character/plan/status/mailingId/orderId", () => {
  const item = mailing();
  const seed = seedWith({ mailings: [item] });
  for (const query of ["Ava Example", "ava@example.test", "Ringo", "12-month", "To Prepare", "MAIL-1", "ORD-1"]) {
    assert.equal(computeQaData(seed, {}, new Set(), {}, "all", "all", query, TODAY, NO_LETTER_FOLDER).rows.length, 1, `query "${query}" should match`);
  }
  assert.equal(computeQaData(seed, {}, new Set(), {}, "all", "all", "zzz-no-match-zzz", TODAY, NO_LETTER_FOLDER).rows.length, 0);
});

test("computeQaData's batchDate filters to mailings shipping on that exact date, and is empty when batchFilter is 'all'", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-1ST", shipDate: "2026-08-15" }), mailing({ mailingId: "MAIL-15TH", shipDate: "2026-08-01" })],
  });
  const filtered = computeQaData(seed, {}, new Set(), {}, "2026-08-15", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.equal(filtered.batchDate, "2026-08-15");
  assert.deepEqual(
    filtered.rows.map((row) => row.mailing.mailingId),
    ["MAIL-1ST"],
  );

  const unfiltered = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.equal(unfiltered.batchDate, "");
  assert.equal(unfiltered.rows.length, 2);
});

test("computeQaData caps at 180 rows", () => {
  const mailings = Array.from({ length: 190 }, (_, i) => mailing({ mailingId: `MAIL-${i}`, orderId: `ORD-${i}` }));
  const seed = seedWith({ mailings });
  assert.equal(computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER).rows.length, 180);
});

test("computeQaData sorts rows with an active High exception first, then by envelope stock/drive character key/recipient name", () => {
  const seed = seedWith({
    mailings: [
      mailing({ mailingId: "MAIL-CLEAN-B", recipientName: "Zoe" }),
      mailing({ mailingId: "MAIL-FLAGGED", recipientName: "Ava" }),
      mailing({ mailingId: "MAIL-CLEAN-A", recipientName: "Ava" }),
    ],
    exceptions: [exception({ mailingId: "MAIL-FLAGGED", severity: "High" })],
  });
  const { rows } = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.equal(rows[0].mailing.mailingId, "MAIL-FLAGGED", "the row with an active High exception sorts first, regardless of name");
  assert.deepEqual(
    rows.slice(1).map((row) => row.mailing.mailingId),
    ["MAIL-CLEAN-A", "MAIL-CLEAN-B"],
    "remaining rows fall back to recipient name (same character/stock here)",
  );
});

test("an active High exception never excludes a QA row (unlike Production Queue) - it only affects sort priority and the row's own flags", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-1" })],
    exceptions: [exception({ mailingId: "MAIL-1", severity: "High" })],
  });
  const { rows } = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.equal(rows.length, 1, "unlike Queue's computeQueueRows, QA never filters out high-exception mailings - QA is exactly where they need review");

  const reviewed = new Set(["MAIL-1::SUB-1::Missing email::2026-08-15"]);
  const reviewedResult = computeQaData(seed, {}, reviewed, {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.equal(reviewedResult.rows.length, 1);
  assert.ok(!reviewedResult.rows[0].flags.some((flag) => flag.text === "Missing email"), "a reviewed exception no longer shows as a flag");
});

test("each row's fieldValues reflect componentOverrides, falling back to the computed default for every one of the seven QA_FIELDS keys", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const { rows } = computeQaData(seed, {}, new Set(), { "MAIL-1::2::qa": "Ready" }, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  const row = rows[0];
  assert.deepEqual(
    Object.keys(row.fieldValues).sort(),
    QA_FIELDS.map((field) => field.key).sort(),
  );
  assert.equal(row.fieldValues.qa, "Ready", "explicit override wins");
  assert.equal(row.fieldValues.envelope, "In Ashley Box", "12-month is prepaid bulk - envelope defaults to In Ashley Box, not Need Print");
  assert.equal(row.fieldValues.payment, "Active", "no active exception - payment defaults to Active");
});

test("isReady/needsAttention on each row match the shared qaIsReady/qaNeedsAttention selectors, not a re-derived copy", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const notReady = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER).rows[0];
  assert.equal(notReady.isReady, false);
  assert.equal(notReady.needsAttention, true);

  const fullyReadyOverrides = {
    "MAIL-1::2::payment": "Active",
    "MAIL-1::2::envelope": "In Ashley Box",
    "MAIL-1::2::letter": "Stuffed",
    "MAIL-1::2::artifact": "Packed",
    "MAIL-1::2::insert": "Not Needed",
    "MAIL-1::2::location": "Ashley",
    "MAIL-1::2::qa": "Ready",
  };
  const ready = computeQaData(seed, {}, new Set(), fullyReadyOverrides, "all", "all", "", TODAY, NO_LETTER_FOLDER).rows[0];
  assert.equal(ready.isReady, true);
  assert.equal(ready.needsAttention, false);
});

test("summary counts (readyCount/envelopePrintCount/needsCheckCount/problemCount) are derived from the same rows, not recomputed independently", () => {
  const ready = mailing({ mailingId: "MAIL-READY", plan: "12-month", character: "Ringo" });
  const needsPrint = mailing({ mailingId: "MAIL-PRINT", plan: "Month-to-month", character: "Ringo", sourceRow: 3 });
  const seed = seedWith({ mailings: [ready, needsPrint] });
  const readyOverrides = {
    "MAIL-READY::2::payment": "Active",
    "MAIL-READY::2::envelope": "In Ashley Box",
    "MAIL-READY::2::letter": "Stuffed",
    "MAIL-READY::2::artifact": "Packed",
    "MAIL-READY::2::insert": "Not Needed",
    "MAIL-READY::2::location": "Ashley",
    "MAIL-READY::2::qa": "Ready",
  };
  const data = computeQaData(seed, {}, new Set(), readyOverrides, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.equal(data.readyCount, 1);
  assert.equal(data.problemCount, 0, "neither row's qa is 'Problem' and both have payment 'Active'");
  // MAIL-PRINT (Month-to-month, not prepaid) defaults envelope to "Need
  // Print" with quantity 2 (Month-to-month mailings print 2 envelopes).
  assert.equal(data.envelopePrintCount, 2);
  assert.equal(data.needsCheckCount, 1, "MAIL-PRINT still needs attention (artifact/qa defaults)");
});

test("each row's flags include active exceptions, a 'Letter folder not mapped' flag when letterFolderUrl returns falsy, and the Month-to-month/Prebuilt plan flag", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "Month-to-month" });
  const seed = seedWith({ mailings: [m], exceptions: [exception({ mailingId: "MAIL-1", severity: "Low", reason: "Ship date is not a 1st/15th batch" })] });
  const reviewed = new Set(); // the Low exception isn't excluded from QA rows, so it stays active and visible as a flag
  const row = computeQaData(seed, {}, reviewed, {}, "all", "all", "", TODAY, NO_LETTER_FOLDER).rows[0];
  const flagTexts = row.flags.map((flag) => flag.text);
  assert.ok(flagTexts.includes("Ship date is not a 1st/15th batch"));
  assert.ok(flagTexts.includes("Letter folder not mapped"));
  assert.ok(flagTexts.includes("Month-to-month"));

  const mapped = computeQaData(seed, {}, reviewed, {}, "all", "all", "", TODAY, HAS_LETTER_FOLDER).rows[0];
  assert.ok(!mapped.flags.map((flag) => flag.text).includes("Letter folder not mapped"));
});

test("a prepaid (6/12-month) mailing's flags say 'Prebuilt', not 'Month-to-month'", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month" });
  const seed = seedWith({ mailings: [m] });
  const row = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, HAS_LETTER_FOLDER).rows[0];
  assert.ok(row.flags.map((flag) => flag.text).includes("Prebuilt"));
});

test("computeQaData is deterministic given the same today - same inputs, same output, called twice", () => {
  const seed = seedWith({ mailings: [mailing(), mailing({ mailingId: "MAIL-2", orderId: "ORD-2", sourceRow: 3 })] });
  const a = computeQaData(seed, {}, new Set(), {}, "next", "all", "", TODAY, NO_LETTER_FOLDER);
  const b = computeQaData(seed, {}, new Set(), {}, "next", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.deepEqual(a, b);
});

test("printedEnvelopeStatusForMailing: 'Both Printed' for more than one envelope, 'Printed' otherwise - same rule as legacy's own", () => {
  assert.equal(printedEnvelopeStatusForMailing({ envelopeQuantity: 1 }), "Printed");
  assert.equal(printedEnvelopeStatusForMailing({ envelopeQuantity: 2 }), "Both Printed");
});
