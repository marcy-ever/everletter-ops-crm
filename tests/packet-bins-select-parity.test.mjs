// The whole justification for wiring Batch Packet's mobile-card selects
// to Ashley Bins' own [data-bin-select] handler (step 16, CLAUDE.md,
// second commit) rather than inventing new behavior: for the SAME
// mailing, shown in both views' row lists, the write this produces has to
// be identical - same data-bin-select key format, same field options,
// same current value read from the exact same componentStatus() call.
// If these two views ever disagreed on any of that, calling the wiring a
// "fix" would be wrong; it would be a second, subtly different behavior
// wearing the first one's name.
//
// A prepaid (12-month) mailing is guaranteed to appear in BOTH views'
// default row lists: Ashley Bins only ever shows Prepaid bulk plans
// (binRows()'s own filter), and Batch Packet's packetRows() has no such
// restriction, so the same fixture mailing shows up in both
// computeBinsData()'s rows and computePacketData()'s mobileRows for the
// identical seed/state - not a contrived overlap.
import assert from "node:assert/strict";
import test from "node:test";
import { computeBinsData } from "../app/crm/views/bins/bins-selectors.ts";
import { computePacketData } from "../app/crm/views/packet/packet-selectors.ts";
import { mailingKey } from "../lib/domain/keys.ts";

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
const NO_LETTER_FOLDER = () => "";

test("the same prepaid mailing appears in both Ashley Bins' rows and Batch Packet's mobileRows for the same seed/state - the overlap this parity proof depends on", () => {
  const m = mailing({ mailingId: "MAIL-1" });
  const seed = seedWith({ mailings: [m] });

  const binsData = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  const packetData = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []);

  assert.equal(binsData.rows.length, 1);
  assert.equal(packetData.mobileRows.length, 1);
  assert.equal(mailingKey(binsData.rows[0].mailing), mailingKey(packetData.mobileRows[0].mailing));
});

test("both views read the identical envelope/letter/location values from componentStatus, for defaults with no overrides", () => {
  const m = mailing({ mailingId: "MAIL-1" });
  const seed = seedWith({ mailings: [m] });

  const binRow = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY).rows[0];
  const packetRow = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []).mobileRows[0];

  assert.deepEqual(binRow.fieldValues, packetRow.fieldValues);
});

test("both views read the identical values with a real componentOverride applied - not just matching on the shared default", () => {
  const m = mailing({ mailingId: "MAIL-1" });
  const seed = seedWith({ mailings: [m] });
  const componentOverrides = { "MAIL-1::2::envelope": "Printed", "MAIL-1::2::letter": "Printed", "MAIL-1::2::location": "Batch Bin" };

  const binRow = computeBinsData(seed, {}, new Set(), componentOverrides, "all", "", TODAY).rows[0];
  const packetRow = computePacketData(seed, {}, new Set(), componentOverrides, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []).mobileRows[0];

  assert.deepEqual(binRow.fieldValues, { envelope: "Printed", letter: "Printed", location: "Batch Bin" });
  assert.deepEqual(binRow.fieldValues, packetRow.fieldValues);
});

test("both views' rendered data-bin-select key format is identical for the same mailing and field - mailingKey()::field::fieldName, byte for byte", () => {
  const m = mailing({ mailingId: "MAIL-1" });
  const seed = seedWith({ mailings: [m] });

  const binRow = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY).rows[0];
  const packetRow = computePacketData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, () => []).mobileRows[0];

  for (const field of ["envelope", "letter", "location"]) {
    const binKey = `${mailingKey(binRow.mailing)}::field::${field}`;
    const packetKey = `${mailingKey(packetRow.mailing)}::field::${field}`;
    assert.equal(binKey, packetKey);
  }
});
