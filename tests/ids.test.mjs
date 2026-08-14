import assert from "node:assert/strict";
import test from "node:test";
import { buildSubscriberId, buildRecipientId, buildSubscriptionId, buildMailingId } from "../lib/ids.ts";

// Format-locking tests, not parity tests. Until step 3a of the app.js
// decomposition plan, this file booted a sandboxed app.js and diffed its
// output against lib/ids.ts for the same inputs - proving the two mirrored
// copies agreed, not that either was actually correct. Now lib/ids.ts is
// the only implementation (app/crm/legacy-app.js imports it directly), so
// "the two copies agree" is no longer a meaningful thing to assert - what
// actually matters, and what these literal values lock, is that the format
// itself doesn't drift. A drifted id format would silently orphan every
// override row already keyed by the old format in the live database, and
// nothing else in the suite would catch that.
//
// Every literal value below was captured by running the pre-refactor
// lib/ids.ts (byte-identical to app.js's own copy at the time) over these
// exact sample inputs, before any implementation code in this change was
// touched - not reverse-engineered from the new code after the fact.

test("buildSubscriberId produces the documented format for sample data", () => {
  const samples = [
    [{ email: "marcy@theeverletter.com", recipientName: "Marcy Example", address: "1 Main St" }, "SUB-9EA39F1E6FB7496334D0F77C"],
    [{ email: "", recipientName: "No Email Person", address: "2 Oak Ave" }, "SUB-E2D64D33AFA44275952C6322"],
    [{ email: null, recipientName: "Café Résumé", address: "3 Elm St" }, "SUB-33754DAF136B5947B8AC11AC"],
    [{ email: "a@b.com", recipientName: "", address: "" }, "SUB-1AB46B8A14DB234D6865C044"],
  ];
  for (const [input, expected] of samples) {
    assert.equal(buildSubscriberId(input), expected);
  }
});

test("buildRecipientId produces the documented format for sample data", () => {
  const samples = [
    [{ subscriberId: "SUB-EXAMPLE", recipientName: "Karsyn Duquaine", address: "4231 S Sunburst Ln" }, "REC-A792D2C48FA9C44F2D978ACA"],
    [{ subscriberId: "SUB-EXAMPLE", recipientName: "Dorothy Fitzgerald", address: "526 1st St" }, "REC-B9E4348AB6C0007EAE855AD1"],
    [{ subscriberId: "SUB-X", recipientName: "", address: "" }, "REC-BD745F4D4044D677EA89BD54"],
  ];
  for (const [input, expected] of samples) {
    assert.equal(buildRecipientId(input), expected);
  }
});

test("buildSubscriptionId produces the documented format for sample data", () => {
  const samples = [
    [{ recipientId: "REC-EXAMPLE", character: "Marley", plan: "Month-to-month" }, "PLAN-5048BEFF0E78DEEA731B65BC"],
    [{ recipientId: "REC-EXAMPLE", character: "Mothers Day", plan: "One-time" }, "PLAN-40A0122F6731E0FC68A5E4F3"],
    [{ recipientId: "REC-X", character: "", plan: "" }, "PLAN-1E48F9CC212CE92CCF830F45"],
  ];
  for (const [input, expected] of samples) {
    assert.equal(buildSubscriptionId(input), expected);
  }
});

test("buildMailingId produces the documented format for sample data", () => {
  const samples = [
    [{ orderId: "ORD-1001", recipientId: "REC-EXAMPLE", character: "Marley", letterNumber: "3", sourceRow: 12 }, "MAIL-EED14A358298CDF96A8A191F"],
    [{ orderId: "ORD-1002", recipientId: "REC-EXAMPLE", character: "Oliver", letterNumber: "", sourceRow: 99 }, "MAIL-9D9C4396916E8554A1A9B79E"],
    [{ orderId: "ORD-MISSING-5", recipientId: "REC-X", character: "", letterNumber: null, sourceRow: 5 }, "MAIL-ED90603DD119C3CF274D12F8"],
  ];
  for (const [input, expected] of samples) {
    assert.equal(buildMailingId(input), expected);
  }
});

test("ids stay short and bounded regardless of input length (hashed, not embedded raw)", () => {
  // Regression guard: without hashing (see lib/ids.ts's module comment),
  // these ids would embed their raw slugged input text, with each layer
  // re-embedding the layer below, so length would grow unboundedly with
  // input length. Hashing keeps length constant - PREFIX- (varies) + a
  // fixed 24-char hex digest - no matter how long the underlying
  // name/address/character/plan text is.
  const longName = "A Very Long Recipient Name That Keeps Going And Going And Going";
  const longAddress = "1234 An Extremely Long Street Name Boulevard Avenue, Some City, ST 99999";

  const subscriberId = buildSubscriberId({ email: "", recipientName: longName, address: longAddress });
  assert.equal(subscriberId.length, "SUB-".length + 24, `expected a fixed-length id, got ${subscriberId.length} chars: ${subscriberId}`);
  assert.equal(subscriberId, "SUB-305D822CCC53A8D11DB4A838");

  const recipientId = buildRecipientId({ subscriberId, recipientName: longName, address: longAddress });
  assert.equal(recipientId.length, "REC-".length + 24, `expected a fixed-length id, got ${recipientId.length} chars: ${recipientId}`);
  assert.equal(recipientId, "REC-7CD4F80BD9FFD4CD907A35C6");
});

test("ids are deterministic - same input always produces the same id (load-bearing for re-import upserts)", () => {
  const input = { email: "repeat@example.com", recipientName: "Repeat Person", address: "1 Repeat St" };
  const expected = "SUB-4BBB112DBF7964C2A8583653";
  for (let i = 0; i < 5; i++) {
    assert.equal(buildSubscriberId({ ...input }), expected);
  }
});

test("buildRecipientId no longer collides two different real recipients sharing a long subscriberId prefix", () => {
  // Regression case from the real spreadsheet: two different people under
  // the same subscriber account, real names/addresses drawn from a pair
  // that a fixed-length truncation would land inside the shared
  // subscriberId prefix, before either recipient's own name/address could
  // differentiate them (see lib/ids.ts's module comment).
  const subscriberId = buildSubscriberId({
    email: "bridgette.duquaine@aah.org",
    recipientName: "unused",
    address: "unused",
  });
  assert.equal(subscriberId, "SUB-5D36EEB928B4293785F2472D");
  const a = buildRecipientId({ subscriberId, recipientName: "Miss Karsyn Duquaine", address: "4231 S Sunburst Lane" });
  const b = buildRecipientId({ subscriberId, recipientName: "Dorothy Fitzgerald", address: "526 1st Street" });
  assert.notEqual(a, b);
  assert.equal(a, "REC-719B1EE1991E392F3AF65355");
  assert.equal(b, "REC-DE9C5F8786D7B47270100D73");
});

test("buildSubscriptionId no longer collides two different characters/plans for the same recipient", () => {
  // Same real subscriber account as the recipientId case above: two orders
  // for the same recipient, different character and plan, that a
  // fixed-length truncation would collide onto one subscriptionId (see
  // lib/ids.ts's module comment).
  const recipientId = "REC-SUB-BRIDGETTE-DUQUAINE";
  const a = buildSubscriptionId({ recipientId, character: "Mothers Day", plan: "One-time" });
  const b = buildSubscriptionId({ recipientId, character: "Marley", plan: "Month-to-month" });
  assert.notEqual(a, b);
  assert.equal(a, "PLAN-A7811344EE9D3D6087B71935");
  assert.equal(b, "PLAN-45A3C820B3F19DAA48D9D5F8");
});
