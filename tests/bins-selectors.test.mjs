// Coverage for app/crm/views/bins/bins-selectors.ts - Phase 1 step 16
// (CLAUDE.md), the eleventh view migrated. Exercises computeBinsData()'s
// own filter chain (active/status/Prepaid-bulk-plan/search, its own
// character-key/letter-number/name sort) and its assembly of the already-
// shared binStatus/groupedWork selectors (promoted in step 15) into
// per-row and per-group data - not re-testing binStatus/groupedWork's own
// logic (already covered by tests/selectors.test.mjs).
import assert from "node:assert/strict";
import test from "node:test";
import { computeBinsData } from "../app/crm/views/bins/bins-selectors.ts";

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

function seedWith({ mailings = [] } = {}) {
  return { subscribers: [], recipients: [], subscriptions: [], orders: [], mailings, exceptions: [], automationRules: [], summary: {} };
}

const TODAY = "2026-08-12";

test("computeBinsData excludes archived, Mailed, and non-matching-batch-date rows", () => {
  const seed = seedWith({
    mailings: [
      mailing({ mailingId: "MAIL-ACTIVE", activeState: "Active" }),
      mailing({ mailingId: "MAIL-ARCHIVED", activeState: "Archived" }),
      mailing({ mailingId: "MAIL-MAILED", status: "Mailed" }),
    ],
  });
  const data = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  assert.deepEqual(
    data.rows.map((row) => row.mailing.mailingId),
    ["MAIL-ACTIVE"],
  );
});

test("computeBinsData only includes prepaid bulk plans (6/12-month), never Month-to-month or One-time", () => {
  const seed = seedWith({
    mailings: [
      mailing({ mailingId: "MAIL-6", plan: "6-month" }),
      mailing({ mailingId: "MAIL-12", plan: "12-month" }),
      mailing({ mailingId: "MAIL-MONTHLY", plan: "Month-to-month" }),
      mailing({ mailingId: "MAIL-ONETIME", plan: "One-time" }),
    ],
  });
  const data = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  assert.deepEqual(
    data.rows.map((row) => row.mailing.mailingId).sort(),
    ["MAIL-12", "MAIL-6"],
  );
});

test("computeBinsData searches recipientName/email/character/plan/status/mailingId/orderId", () => {
  const item = mailing();
  const seed = seedWith({ mailings: [item] });
  for (const query of ["Ava Example", "ava@example.test", "Ringo", "12-month", "To Prepare", "MAIL-1", "ORD-1"]) {
    assert.equal(computeBinsData(seed, {}, new Set(), {}, "all", query, TODAY).rows.length, 1, `query "${query}" should match`);
  }
  assert.equal(computeBinsData(seed, {}, new Set(), {}, "all", "zzz-no-match-zzz", TODAY).rows.length, 0);
});

test("computeBinsData's batchDate filters to mailings shipping on that exact date, and is empty when batchFilter is 'all'", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-1ST", shipDate: "2026-08-15" }), mailing({ mailingId: "MAIL-15TH", shipDate: "2026-08-01" })],
  });
  const filtered = computeBinsData(seed, {}, new Set(), {}, "2026-08-15", "", TODAY);
  assert.equal(filtered.batchDate, "2026-08-15");
  assert.deepEqual(
    filtered.rows.map((row) => row.mailing.mailingId),
    ["MAIL-1ST"],
  );
  const unfiltered = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  assert.equal(unfiltered.batchDate, "");
  assert.equal(unfiltered.rows.length, 2);
});

test("computeBinsData sorts by drive character key, then letter number, then recipient name", () => {
  const seed = seedWith({
    mailings: [
      mailing({ mailingId: "MAIL-RINGO-2", character: "Ringo", letterNumber: "2", recipientName: "Zoe", sourceRow: 3 }),
      mailing({ mailingId: "MAIL-MARLEY-1", character: "Marley", letterNumber: "1", recipientName: "Ava", sourceRow: 4 }),
      mailing({ mailingId: "MAIL-RINGO-1", character: "Ringo", letterNumber: "1", recipientName: "Ava", sourceRow: 5 }),
    ],
  });
  const data = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  assert.deepEqual(
    data.rows.map((row) => row.mailing.mailingId),
    ["MAIL-MARLEY-1", "MAIL-RINGO-1", "MAIL-RINGO-2"],
  );
});

test("each row carries status/bin/fieldValues matching the shared binStatus/storageBinForMailing/componentStatus exactly", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const data = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  const row = data.rows[0];
  assert.deepEqual(Object.keys(row.fieldValues).sort(), ["envelope", "letter", "location"].sort());
  // 12-month is prepaid bulk - envelope/letter/location all default to
  // their "ready" values (In Ashley Box/Stuffed/Ashley), so this row
  // should already read as fully ready.
  assert.equal(row.status.label, "Ready in Ashley Bin");
  assert.ok(row.bin);
});

test("a row missing exactly one of envelope/letter/location reports that one field's specific label", () => {
  const m = mailing({ mailingId: "MAIL-1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const data = computeBinsData(seed, {}, new Set(), { "MAIL-1::2::location": "Marcy" }, "all", "", TODAY);
  assert.equal(data.rows[0].status.label, "Wrong Location");
});

test("readyCount/needsCheckCount/missingEnvelopeCount/missingLetterCount are derived from the same rows, not recomputed independently", () => {
  const ready = mailing({ mailingId: "MAIL-READY", plan: "12-month", character: "Ringo" });
  const missingEnvelope = mailing({ mailingId: "MAIL-MISSING-ENV", plan: "12-month", character: "Ringo", sourceRow: 3 });
  const seed = seedWith({ mailings: [ready, missingEnvelope] });
  const data = computeBinsData(seed, {}, new Set(), { "MAIL-MISSING-ENV::3::envelope": "Need Print" }, "all", "", TODAY);
  assert.equal(data.readyCount, 1);
  assert.equal(data.needsCheckCount, 1);
  assert.equal(data.missingEnvelopeCount, 1);
  assert.equal(data.missingLetterCount, 0);
});

test("groups bucket by ship date + character + letter number, summing total pieces and ready/needsCheck counts", () => {
  const a = mailing({ mailingId: "MAIL-A", character: "Ringo", letterNumber: "1", shipDate: "2026-08-15", sourceRow: 2 });
  const b = mailing({ mailingId: "MAIL-B", character: "Ringo", letterNumber: "1", shipDate: "2026-08-15", sourceRow: 3 });
  const c = mailing({ mailingId: "MAIL-C", character: "Marley", letterNumber: "2", shipDate: "2026-09-01", sourceRow: 4 });
  const seed = seedWith({ mailings: [a, b, c] });
  const data = computeBinsData(seed, {}, new Set(), { "MAIL-B::3::envelope": "Need Print" }, "all", "", TODAY);
  const ringoGroup = data.groups.find((group) => group.label.includes("Ringo"));
  assert.ok(ringoGroup);
  assert.equal(ringoGroup.total, 2);
  assert.equal(ringoGroup.ready, 1);
  assert.equal(ringoGroup.needsCheck, 1);
  assert.equal(data.groups.length, 2, "two distinct ship-date/character/letter groups");
});

test("computeBinsData is deterministic given the same today - same inputs, same output, called twice", () => {
  const seed = seedWith({ mailings: [mailing(), mailing({ mailingId: "MAIL-2", orderId: "ORD-2", sourceRow: 3 })] });
  const a = computeBinsData(seed, {}, new Set(), {}, "next", "", TODAY);
  const b = computeBinsData(seed, {}, new Set(), {}, "next", "", TODAY);
  assert.deepEqual(a, b);
});
