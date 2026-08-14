import assert from "node:assert/strict";
import test from "node:test";
import {
  mailingKey,
  componentKey,
  exceptionReviewKey,
  parseMailingKey,
  parseComponentKey,
  parseExceptionReviewKey,
} from "../lib/keys.ts";

// Format-locking tests, not parity tests - see tests/ids.test.mjs's module
// comment for why (same reasoning, same step 3a change: app/crm/legacy-app.js
// now imports lib/keys.ts directly instead of keeping a mirrored copy).
//
// Every literal value below was captured by running the pre-refactor
// lib/keys.ts (byte-identical to app.js's own copy at the time) over these
// exact sample inputs, before any implementation code in this change was
// touched.

test("mailingKey produces the documented mailingId::sourceRow shape for sample data", () => {
  const samples = [
    [{ mailingId: "MAIL-ABC123", sourceRow: 5 }, "MAIL-ABC123::5"],
    [{ mailingId: "MAIL-XYZ-789", sourceRow: "12" }, "MAIL-XYZ-789::12"],
    [{ mailingId: "MAIL-EDGE", sourceRow: 0 }, "MAIL-EDGE::0"],
  ];
  for (const [mailing, expected] of samples) {
    assert.equal(mailingKey(mailing), expected);
  }
});

test("componentKey produces the documented mailingId::sourceRow::field shape for sample data", () => {
  const mailing = { mailingId: "MAIL-ABC123", sourceRow: 5 };
  const samples = [
    ["envelope", "MAIL-ABC123::5::envelope"],
    ["letter", "MAIL-ABC123::5::letter"],
    ["artifact", "MAIL-ABC123::5::artifact"],
    ["insert", "MAIL-ABC123::5::insert"],
    ["location", "MAIL-ABC123::5::location"],
    ["payment", "MAIL-ABC123::5::payment"],
    ["qa", "MAIL-ABC123::5::qa"],
  ];
  for (const [field, expected] of samples) {
    assert.equal(componentKey(mailing, field), expected);
  }
});

test("exceptionReviewKey produces the documented shape, including placeholder fallbacks, for sample data", () => {
  const samples = [
    [{ mailingId: "MAIL-1", subscriberId: "SUB-1", reason: "Missing ship date", shipDate: "2026-01-15" }, "MAIL-1::SUB-1::Missing ship date::2026-01-15"],
    [{ mailingId: "MAIL-2", subscriberId: "SUB-2", reason: "Missing recipient; Missing address", shipDate: "" }, "MAIL-2::SUB-2::Missing recipient; Missing address::no-ship-date"],
    [{}, "unknown-mailing::unknown-subscriber::unknown-reason::no-ship-date"],
    [{ mailingId: "MAIL-3" }, "MAIL-3::unknown-subscriber::unknown-reason::no-ship-date"],
  ];
  for (const [item, expected] of samples) {
    assert.equal(exceptionReviewKey(item), expected);
  }
});

test("parseMailingKey round-trips a well-formed key", () => {
  const key = mailingKey({ mailingId: "MAIL-A", sourceRow: 7 });
  assert.deepEqual(parseMailingKey(key), { mailingId: "MAIL-A", sourceRow: "7" });
});

test("parseMailingKey rejects malformed keys instead of guessing", () => {
  assert.equal(parseMailingKey("too::many::segments"), null);
  assert.equal(parseMailingKey("no-separator"), null);
  assert.equal(parseMailingKey(""), null);
  assert.equal(parseMailingKey("::"), null);
  assert.equal(parseMailingKey(undefined), null);
  assert.equal(parseMailingKey(null), null);
});

test("parseComponentKey round-trips a well-formed key", () => {
  const key = componentKey({ mailingId: "MAIL-A", sourceRow: 7 }, "envelope");
  assert.deepEqual(parseComponentKey(key), { mailingId: "MAIL-A", sourceRow: "7", field: "envelope" });
});

test("parseComponentKey rejects malformed keys instead of guessing", () => {
  assert.equal(parseComponentKey("MAIL-A::7"), null);
  assert.equal(parseComponentKey("MAIL-A::7::envelope::extra"), null);
  assert.equal(parseComponentKey(""), null);
});

test("parseExceptionReviewKey round-trips a well-formed key", () => {
  const key = exceptionReviewKey({
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    reason: "Missing ship date",
    shipDate: "2026-01-15",
  });
  assert.deepEqual(parseExceptionReviewKey(key), {
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    reason: "Missing ship date",
    shipDate: "2026-01-15",
  });
});

test("parseExceptionReviewKey rejects malformed keys instead of guessing", () => {
  assert.equal(parseExceptionReviewKey("MAIL-1::SUB-1::reason-only-3-parts"), null);
  assert.equal(parseExceptionReviewKey(""), null);
  assert.equal(parseExceptionReviewKey(42), null);
});
