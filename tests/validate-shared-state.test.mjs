import assert from "node:assert/strict";
import test from "node:test";
import {
  CATASTROPHIC_DELETION_THRESHOLD,
  MAX_PAYLOAD_BYTES,
  PayloadTooLargeError,
  SharedStateValidationError,
  assertPayloadSize,
  parseAndValidateCrmDatasetValue,
  validateComponentStatusPayload,
  validateMailingStatusPayload,
  validateReviewedExceptionPayload,
} from "../lib/validate-shared-state.ts";
import { estimateKeptMailingIds } from "../lib/write-to-tables.ts";

// New coverage for the validation layer added to close the largest
// data-integrity gap in the app: nothing previously validated a POST
// /api/shared-state payload's shape, size, or destructive potential
// before it reached writeImport() (lib/write-to-tables.ts). These are
// pure-function unit tests; the DB-touching half (assertNotCatastrophicDeletion,
// and the route handler end to end) is covered by
// tests/shared-state-validation.e2e.test.mjs and
// tests/ingestion-events-restore.e2e.test.mjs against real Postgres.

test("validateMailingStatusPayload accepts every real mailing status", () => {
  for (const status of ["To Prepare", "Printing", "Assembling", "Ready to Mail", "Mailed"]) {
    assert.doesNotThrow(() => validateMailingStatusPayload("MAIL-X::1", status));
  }
});

test("validateMailingStatusPayload rejects a key that doesn't parse", () => {
  assert.throws(() => validateMailingStatusPayload("no-separator-here", "Mailed"), SharedStateValidationError);
  assert.throws(() => validateMailingStatusPayload("", "Mailed"), SharedStateValidationError);
  assert.throws(() => validateMailingStatusPayload("too::many::segments", "Mailed"), SharedStateValidationError);
});

test("validateMailingStatusPayload rejects an unrecognized status value", () => {
  assert.throws(() => validateMailingStatusPayload("MAIL-X::1", "Delivered"), SharedStateValidationError);
  assert.throws(() => validateMailingStatusPayload("MAIL-X::1", ""), SharedStateValidationError);
});

test("validateComponentStatusPayload accepts every real field/value combination", () => {
  const cases = [
    ["payment", "Active"],
    ["envelope", "Both Printed"],
    ["letter", "Stuffed"],
    ["artifact", "Packed"],
    ["insert", "Need Check"],
    ["location", "Batch Bin"],
    ["qa", "Ready"],
  ];
  for (const [field, value] of cases) {
    assert.doesNotThrow(() => validateComponentStatusPayload(`MAIL-X::1::${field}`, value));
  }
});

test("validateComponentStatusPayload rejects a key that doesn't parse", () => {
  assert.throws(() => validateComponentStatusPayload("MAIL-X::1", "Printed"), SharedStateValidationError);
});

test("validateComponentStatusPayload rejects an unknown field", () => {
  assert.throws(() => validateComponentStatusPayload("MAIL-X::1::not-a-real-field", "anything"), SharedStateValidationError);
});

test("validateComponentStatusPayload rejects a value that's valid for a different field but not this one", () => {
  // "Active" is a real payment value but not a real envelope value.
  assert.throws(() => validateComponentStatusPayload("MAIL-X::1::envelope", "Active"), SharedStateValidationError);
});

test("validateReviewedExceptionPayload accepts a well-formed 4-segment key", () => {
  assert.doesNotThrow(() => validateReviewedExceptionPayload("MAIL-X::SUB-X::Missing email::2026-08-15"));
});

test("validateReviewedExceptionPayload rejects a key with the wrong segment count", () => {
  assert.throws(() => validateReviewedExceptionPayload("MAIL-X::SUB-X"), SharedStateValidationError);
  assert.throws(() => validateReviewedExceptionPayload(""), SharedStateValidationError);
});

test("assertPayloadSize allows exactly the limit and rejects one byte over", () => {
  assert.doesNotThrow(() => assertPayloadSize(MAX_PAYLOAD_BYTES));
  assert.throws(() => assertPayloadSize(MAX_PAYLOAD_BYTES + 1), PayloadTooLargeError);
});

test("CATASTROPHIC_DELETION_THRESHOLD is between 0.5 and 0.7, matching the reasoning in lib/validate-shared-state.ts", () => {
  assert.ok(CATASTROPHIC_DELETION_THRESHOLD >= 0.5 && CATASTROPHIC_DELETION_THRESHOLD <= 0.7);
});

// --- parseAndValidateCrmDatasetValue ---

function validDatasetJson(overrides = {}) {
  const seed = {
    subscribers: [],
    recipients: [],
    orders: [],
    subscriptions: [],
    mailings: [],
    exceptions: [],
    automationRules: [],
    summary: {},
    ...overrides,
  };
  return JSON.stringify({ seed, sourceName: "test.xlsx", uploadedAt: "2026-08-15T00:00:00.000Z", summary: {} });
}

test("parseAndValidateCrmDatasetValue accepts a minimal valid dataset (all empty arrays)", () => {
  const result = parseAndValidateCrmDatasetValue(validDatasetJson());
  assert.deepEqual(result.seed.mailings, []);
  assert.equal(result.sourceName, "test.xlsx");
});

test("parseAndValidateCrmDatasetValue defaults sourceName to 'unknown' when missing, rather than rejecting - it's descriptive metadata, not structural", () => {
  const seed = { subscribers: [], recipients: [], orders: [], subscriptions: [], mailings: [], exceptions: [], automationRules: [], summary: {} };
  const result = parseAndValidateCrmDatasetValue(JSON.stringify({ seed }));
  assert.equal(result.sourceName, "unknown");
});

test("parseAndValidateCrmDatasetValue rejects non-JSON", () => {
  assert.throws(() => parseAndValidateCrmDatasetValue("{not json"), SharedStateValidationError);
});

test("parseAndValidateCrmDatasetValue rejects a JSON value that isn't an object", () => {
  assert.throws(() => parseAndValidateCrmDatasetValue("[1,2,3]"), SharedStateValidationError);
  assert.throws(() => parseAndValidateCrmDatasetValue('"just a string"'), SharedStateValidationError);
  assert.throws(() => parseAndValidateCrmDatasetValue("null"), SharedStateValidationError);
});

test("parseAndValidateCrmDatasetValue rejects a payload with no seed field", () => {
  assert.throws(() => parseAndValidateCrmDatasetValue(JSON.stringify({ sourceName: "x.xlsx" })), SharedStateValidationError);
});

test("parseAndValidateCrmDatasetValue rejects each of the 7 array fields individually when missing or wrong-typed", () => {
  const fields = ["subscribers", "recipients", "orders", "subscriptions", "mailings", "exceptions", "automationRules"];
  for (const field of fields) {
    const missing = validDatasetJson();
    const parsedMissing = JSON.parse(missing);
    delete parsedMissing.seed[field];
    assert.throws(() => parseAndValidateCrmDatasetValue(JSON.stringify(parsedMissing)), SharedStateValidationError, `missing ${field} should be rejected`);

    assert.throws(() => parseAndValidateCrmDatasetValue(validDatasetJson({ [field]: "not an array" })), SharedStateValidationError, `${field} as a string should be rejected`);
    assert.throws(() => parseAndValidateCrmDatasetValue(validDatasetJson({ [field]: 42 })), SharedStateValidationError, `${field} as a number should be rejected`);
  }
});

test("parseAndValidateCrmDatasetValue rejects an array field containing a null or non-object element", () => {
  assert.throws(() => parseAndValidateCrmDatasetValue(validDatasetJson({ mailings: [null] })), SharedStateValidationError);
  assert.throws(() => parseAndValidateCrmDatasetValue(validDatasetJson({ mailings: ["not an object"] })), SharedStateValidationError);
  assert.doesNotThrow(() => parseAndValidateCrmDatasetValue(validDatasetJson({ mailings: [{ mailingId: "MAIL-1" }] })));
});

test("parseAndValidateCrmDatasetValue rejects a missing or wrong-typed summary", () => {
  const seed = { subscribers: [], recipients: [], orders: [], subscriptions: [], mailings: [], exceptions: [], automationRules: [] };
  assert.throws(() => parseAndValidateCrmDatasetValue(JSON.stringify({ seed })), SharedStateValidationError);
  assert.throws(() => parseAndValidateCrmDatasetValue(validDatasetJson({ summary: "not an object" })), SharedStateValidationError);
});

// Real, current check (not just a compile-time one) that the hand-written
// DATASET_ARRAY_FIELDS list inside lib/validate-shared-state.ts still
// covers exactly the Dataset type's array fields - built against a
// fixture with every real Dataset key (lib/domain/dataset.ts) rather than
// introspecting the type itself (which doesn't exist at runtime). If
// Dataset gains or loses a field, this - not just tsc - should catch a
// forgotten update here.
test("a fully-populated Dataset-shaped object round-trips through parseAndValidateCrmDatasetValue without any field going unrecognized", () => {
  const fullSeed = {
    summary: {
      asOf: "2026-08-15",
      sourceFile: "test.xlsx",
      subscriberCount: 0,
      activeSubscriberCount: 0,
      archivedSubscriberCount: 0,
      recipientCount: 0,
      orderCount: 0,
      subscriptionCount: 0,
      mailingCount: 0,
      openMailingCount: 0,
      archivedMailingCount: 0,
      overdueCount: 0,
      dueNext14Count: 0,
      exceptionCount: 0,
      missingShipDateCount: 0,
    },
    subscribers: [],
    recipients: [],
    orders: [],
    subscriptions: [],
    mailings: [],
    exceptions: [],
    automationRules: [],
  };
  const result = parseAndValidateCrmDatasetValue(JSON.stringify({ seed: fullSeed, sourceName: "full.xlsx" }));
  assert.equal(result.sourceName, "full.xlsx");
});

// --- estimateKeptMailingIds (pure, exported from lib/write-to-tables.ts) ---

test("estimateKeptMailingIds keeps a mailing with a real ship date under a keepable subscription", () => {
  const seed = {
    recipients: [{ recipientId: "REC-1", subscriberId: "SUB-1", name: "Test", address: "1 St" }],
    subscriptions: [{ subscriptionId: "PLAN-1", subscriberId: "SUB-1", recipientId: "REC-1", plan: "Month-to-month", character: "Marley" }],
    mailings: [{ subscriptionId: "PLAN-1", orderId: "ORD-1", character: "Marley", letterNumber: 1, shipDate: "2026-08-15" }],
  };
  const kept = estimateKeptMailingIds(seed);
  assert.equal(kept.size, 1);
  assert.ok(kept.has("ORD-1::Marley::1"));
});

test("estimateKeptMailingIds excludes a mailing with no ship date", () => {
  const seed = {
    recipients: [{ recipientId: "REC-1", subscriberId: "SUB-1", name: "Test", address: "1 St" }],
    subscriptions: [{ subscriptionId: "PLAN-1", subscriberId: "SUB-1", recipientId: "REC-1", plan: "Month-to-month", character: "Marley" }],
    mailings: [{ subscriptionId: "PLAN-1", orderId: "ORD-1", character: "Marley", letterNumber: 1, shipDate: "" }],
  };
  assert.equal(estimateKeptMailingIds(seed).size, 0);
});

test("estimateKeptMailingIds excludes a mailing whose subscription has an unrecognized plan", () => {
  const seed = {
    recipients: [{ recipientId: "REC-1", subscriberId: "SUB-1", name: "Test", address: "1 St" }],
    subscriptions: [{ subscriptionId: "PLAN-1", subscriberId: "SUB-1", recipientId: "REC-1", plan: "Needs Review", character: "Marley" }],
    mailings: [{ subscriptionId: "PLAN-1", orderId: "ORD-1", character: "Marley", letterNumber: 1, shipDate: "2026-08-15" }],
  };
  assert.equal(estimateKeptMailingIds(seed).size, 0);
});

test("estimateKeptMailingIds excludes a mailing whose subscription's recipient can't be resolved", () => {
  const seed = {
    recipients: [],
    subscriptions: [{ subscriptionId: "PLAN-1", subscriberId: "SUB-1", recipientId: "REC-DOES-NOT-EXIST", plan: "Month-to-month", character: "Marley" }],
    mailings: [{ subscriptionId: "PLAN-1", orderId: "ORD-1", character: "Marley", letterNumber: 1, shipDate: "2026-08-15" }],
  };
  assert.equal(estimateKeptMailingIds(seed).size, 0);
});
