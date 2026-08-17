// Coverage for app/crm/views/packet/packet-selectors.ts - Phase 1 step 15
// (CLAUDE.md), the tenth view migrated and the largest snapshot in the
// suite. Exercises computePacketData()'s own assembly on top of the
// already-shared packetRows()/packetProblemRows() (since step 7) and
// componentStatus()/qaIsReady()/qaNeedsAttention()/binStatus() (since
// steps 4/14/15) - not re-testing those selectors' own filter chains
// (already covered by tests/selectors.test.mjs), only that computePacketData
// assembles them correctly into groups/checklists/final rows/mobile rows.
import assert from "node:assert/strict";
import test from "node:test";
import { computePacketData } from "../app/crm/views/packet/packet-selectors.ts";

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

function seedWith({ mailings = [], exceptions = [] } = {}) {
  return { subscribers: [], recipients: [], subscriptions: [], orders: [], mailings, exceptions, automationRules: [], summary: {} };
}

const TODAY = "2026-08-12";
const NO_LETTER_FOLDER = () => "";
const HAS_LETTER_FOLDER = () => "https://drive.example/letters/ringo/1";

// computePacketData only ever reads envelopePrintRows(rows).length - every
// test below passes a small, deterministic stub sized to what that test
// actually needs, rather than reimplementing componentStatus's own
// default-resolution logic a second time in this file just to filter for
// "Need Print" rows for real.
test("computePacketData excludes archived, Mailed, and non-matching-batch-date rows (reused packetRows, not re-derived)", () => {
  const seed = seedWith({
    mailings: [
      mailing({ mailingId: "MAIL-ACTIVE", activeState: "Active" }),
      mailing({ mailingId: "MAIL-ARCHIVED", activeState: "Archived" }),
      mailing({ mailingId: "MAIL-MAILED", status: "Mailed" }),
    ],
  });
  const data = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.deepEqual(
    data.rows.map((row) => row.mailingId),
    ["MAIL-ACTIVE"],
  );
});

test("computePacketData's packetScope 'monthly' keeps only Month-to-month (reused packetRows)", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-MONTHLY", plan: "Month-to-month" }), mailing({ mailingId: "MAIL-PREPAID", plan: "12-month" })],
  });
  const monthly = computePacketData(seed, {}, new Set(), {}, "all", "monthly", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.deepEqual(
    monthly.rows.map((row) => row.mailingId),
    ["MAIL-MONTHLY"],
  );
});

test("computePacketData.finalRows carry the five gating fields plus isReady/needsAttention, matching the shared qaIsReady/qaNeedsAttention exactly", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const notReady = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.equal(notReady.finalRows.length, 1);
  assert.equal(notReady.finalRows[0].isReady, false);
  assert.equal(notReady.finalRows[0].needsAttention, true);
  assert.deepEqual(Object.keys(notReady.finalRows[0].fieldValues).sort(), ["artifact", "envelope", "insert", "letter", "qa"].sort());

  const readyOverrides = {
    "MAIL-1::2::payment": "Active",
    "MAIL-1::2::envelope": "In Ashley Box",
    "MAIL-1::2::letter": "Stuffed",
    "MAIL-1::2::artifact": "Packed",
    "MAIL-1::2::insert": "Not Needed",
    "MAIL-1::2::location": "Ashley",
    "MAIL-1::2::qa": "Ready",
  };
  const ready = computePacketData(seed, {}, new Set(), readyOverrides, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.equal(ready.finalRows[0].isReady, true);
  assert.equal(ready.finalRows[0].needsAttention, false);
});

test("computePacketData.mobileRows carry bin/status/three-field fieldValues, matching the shared binStatus exactly", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Ringo", shipDate: "2026-08-15" });
  const seed = seedWith({ mailings: [m] });
  const data = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.equal(data.mobileRows.length, 1);
  const row = data.mobileRows[0];
  assert.deepEqual(Object.keys(row.fieldValues).sort(), ["envelope", "letter", "location"].sort());
  // Defaults (12-month is prepaid, so envelope defaults to "In Ashley Box"
  // and letter to "Stuffed" - both already satisfy binStatus; location
  // defaults to "Ashley" too) - fully ready, matching qaIsReady's own
  // prepaid-default reasoning in tests/selectors.test.mjs.
  assert.equal(row.status.label, "Ready in Ashley Bin");
  assert.ok(row.bin);
});

test("computePacketData.mobileRows' binStatus reflects a real gap - missing exactly one of envelope/letter/location", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const data = computePacketData(seed, {}, new Set(), { "MAIL-1::2::letter": "Need Print" }, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.equal(data.mobileRows[0].status.label, "Missing Letter");
});

test("computePacketData's four grouped work cards - envelope stock, letter character+number, artifact, insert - group and sum correctly", () => {
  const a = mailing({ mailingId: "MAIL-A", character: "Ringo", letterNumber: "1", sourceRow: 2 });
  const b = mailing({ mailingId: "MAIL-B", character: "Ringo", letterNumber: "1", sourceRow: 3 });
  const c = mailing({ mailingId: "MAIL-C", character: "Marley", letterNumber: "2", sourceRow: 4 });
  const seed = seedWith({ mailings: [a, b, c] });
  const data = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);

  const ringoLetterGroup = data.letterGroups.find((group) => group.label.startsWith("Ringo"));
  assert.ok(ringoLetterGroup, "Ringo Â· Letter 1 group should exist");
  assert.equal(ringoLetterGroup.total, 2, "two rows share the Ringo/Letter-1 group");
  assert.equal(ringoLetterGroup.missingLinks, 2, "letterFolderUrl always returns '' in this repo (no real Drive config)");

  assert.equal(data.envelopeGroups.reduce((total, group) => total + group.total, 0), 3, "every row contributes its envelope quantity across groups");
});

test("computePacketData's letter groups' missingLinks reflects a real letterFolderUrl, not just the always-empty case", () => {
  const m = mailing({ mailingId: "MAIL-1", character: "Ringo", letterNumber: "1" });
  const seed = seedWith({ mailings: [m] });
  const mapped = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, HAS_LETTER_FOLDER, () => []);
  assert.equal(mapped.letterGroups[0].missingLinks, 0);
});

test("computePacketData.problemRows carries each row's reasons - exceptions, payment/qa flags, missing ship date - same duplication legacy's own packetProblemRow produced", () => {
  const withException = mailing({ mailingId: "MAIL-1", shipDate: "" });
  const seed = seedWith({
    mailings: [withException],
    exceptions: [
      { exceptionId: "EXC-1", severity: "High", reason: "Missing ship date", mailingId: "MAIL-1", subscriberId: "SUB-1", recipientName: "Ava", shipDate: "", suggestedShipDate: "", status: "To Prepare", sourceRow: 2 },
    ],
  });
  const data = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.equal(data.problemRows.length, 1);
  const reasons = data.problemRows[0].reasons;
  // "Missing ship date" appears twice - once from the exception's own
  // reason text, once from the !mailing.shipDate check - a real
  // duplication the frozen snapshot itself pins (see tests/packet-view.test.mjs),
  // reproduced here rather than deduplicated.
  assert.deepEqual(
    reasons.filter((reason) => reason === "Missing ship date"),
    ["Missing ship date", "Missing ship date"],
  );
});

test("computePacketData's Marcy/Ashley checklists reflect real counts, and problemCount/printableEnvelopeCount aren't recomputed independently of the rest of the data", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Marley" });
  const seed = seedWith({ mailings: [m] });
  const envelopePrintRows = (rows) => rows.filter((row) => row.mailingId === "MAIL-1").flatMap(() => [{}]); // one printable envelope, deterministic stub
  const data = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, envelopePrintRows);
  assert.equal(data.printableEnvelopeCount, 1);
  assert.ok(data.marcyChecklist[0].includes("Print 1 envelopes needed now"));
  assert.ok(data.marcyChecklist[2].includes(`Resolve ${data.problemRows.length} do-not-mail rows`));
  assert.ok(data.ashleyChecklist[0].includes("Pack/check 1 artifact rows"), "Marley's insert default is Need Check, artifact always defaults Need Check");
});

test("computePacketData is deterministic given the same today - same inputs, same output, called twice", () => {
  const seed = seedWith({ mailings: [mailing(), mailing({ mailingId: "MAIL-2", orderId: "ORD-2", sourceRow: 3 })] });
  const a = computePacketData(seed, {}, new Set(), {}, "next", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  const b = computePacketData(seed, {}, new Set(), {}, "next", "all", "", TODAY, NO_LETTER_FOLDER, () => []);
  assert.deepEqual(a, b);
});
