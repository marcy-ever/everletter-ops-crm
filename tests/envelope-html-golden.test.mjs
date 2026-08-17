// Proves app/crm/views/envelope-print/envelope-html.ts's relocated
// envelopeHtml() produces BYTE-IDENTICAL output to
// tests/fixtures/envelope-html-golden.html (Phase 1 step 17 - CLAUDE.md,
// the last of twelve views, and the only one whose output lands on
// physical paper) - not normalized, not "equivalent under whitespace
// rules" the way every other migrated view's markup proof is. This is a
// pure string function with no JSX involved, so there's no React
// whitespace to excuse: the exact same bytes, or a real difference.
//
// The fixture itself was captured against this exact logic BEFORE it
// moved (see that commit's own message for the full story and why -
// wrong margins, wrong feed orientation, wrong font on the wrong colored
// stock are all things only physical paper reveals, so this is the one
// view where an automated test mistake is most expensive and least able
// to self-correct). The fixture rows are reproduced here exactly -
// same five characters, same addresses (including the missing-address
// and three-plus-part-address branches), same Month-to-month
// 2-of-2-copy row.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { envelopeHtml } from "../app/crm/views/envelope-print/envelope-html.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// envelopeCornerArtUrl() (envelope-html.ts) reads window.location.href to
// build an absolute asset URL - the one real browser dependency this
// generator has. Stubbed here exactly as the capture script stubbed it,
// so the corner-art URLs in this test's output match the fixture's.
globalThis.window = { location: { href: "http://localhost:3000/" } };

function recipient(overrides = {}) {
  return {
    recipientId: overrides.recipientId,
    subscriberId: overrides.subscriberId || "SUB-1",
    name: overrides.name,
    address: overrides.address,
  };
}

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
    character: "Marley",
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

const recipients = [
  recipient({ recipientId: "REC-MARLEY", name: "Ava Example", address: "123 Main St, Springfield, IL 62704" }),
  recipient({ recipientId: "REC-RINGO", name: "Ben Sample", address: "456 Oak Ave, Apt 3B, Portland, OR, 97201" }),
  recipient({ recipientId: "REC-HARPER", name: "Cora Test", address: "" }),
  recipient({ recipientId: "REC-OLIVER", name: "Drew Instance", address: "789 Pine Rd, Austin, TX 78701" }),
  recipient({ recipientId: "REC-PENELOPE", name: "Iris Adultgram", address: "12 Elm Ct, Boston, MA 02108" }),
];

const mailings = [
  mailing({ mailingId: "MAIL-MARLEY", recipientId: "REC-MARLEY", recipientName: "Ava Example", character: "Marley", plan: "12-month", letterNumber: "3", shipDate: "2026-08-15" }),
  mailing({ mailingId: "MAIL-RINGO", recipientId: "REC-RINGO", recipientName: "Ben Sample", character: "Ringo", plan: "6-month", letterNumber: "1", shipDate: "2026-09-01" }),
  mailing({ mailingId: "MAIL-HARPER", recipientId: "REC-HARPER", recipientName: "Cora Test", character: "Harper", plan: "12-month", letterNumber: "5", shipDate: "2026-08-20" }),
  mailing({ mailingId: "MAIL-OLIVER", recipientId: "REC-OLIVER", recipientName: "Drew Instance", character: "Oliver", plan: "Month-to-month", letterNumber: "2", shipDate: "2026-08-18" }),
  mailing({ mailingId: "MAIL-PENELOPE", recipientId: "REC-PENELOPE", recipientName: "Iris Adultgram", character: "Penelope", plan: "12-month", letterNumber: "1", shipDate: "2026-08-22" }),
];

const rows = [
  { ...mailings[0], envelopeCopyNumber: 1, envelopeCopyTotal: 1 },
  { ...mailings[1], envelopeCopyNumber: 1, envelopeCopyTotal: 1 },
  { ...mailings[2], envelopeCopyNumber: 1, envelopeCopyTotal: 1 },
  { ...mailings[3], envelopeCopyNumber: 1, envelopeCopyTotal: 2 },
  { ...mailings[3], envelopeCopyNumber: 2, envelopeCopyTotal: 2 },
  { ...mailings[4], envelopeCopyNumber: 1, envelopeCopyTotal: 1 },
];

const seed = {
  subscribers: [],
  recipients,
  subscriptions: [],
  orders: [],
  mailings,
  exceptions: [],
  automationRules: [],
  summary: {},
};

test("envelopeHtml() produces byte-identical output to the golden fixture captured before the generator moved", () => {
  const actual = envelopeHtml(rows, seed);
  const expected = fs.readFileSync(path.join(ROOT, "tests/fixtures/envelope-html-golden.html"), "utf8");
  assert.equal(actual, expected, "envelopeHtml()'s relocated output no longer matches tests/fixtures/envelope-html-golden.html BYTE FOR BYTE - not a whitespace difference to normalize away, a real change to the generated envelope document.");
});

test("the golden fixture actually exercises what it claims to - five characters, corner art, missing/multi-part addresses, a 2-of-2 copy row", () => {
  const html = fs.readFileSync(path.join(ROOT, "tests/fixtures/envelope-html-golden.html"), "utf8");
  assert.match(html, /Marley Â· Envelope 1 of 1/);
  assert.match(html, /Ringo Â· Envelope 1 of 1/);
  assert.match(html, /Harper Â· Envelope 1 of 1/);
  assert.match(html, /Oliver Â· Envelope 1 of 2/);
  assert.match(html, /Oliver Â· Envelope 2 of 2/);
  assert.match(html, /Penelope Â· Envelope 1 of 1/);
  assert.match(html, /class="corner-art art-marley"/);
  assert.match(html, /class="corner-art art-ringo"/);
  assert.match(html, /class="corner-art art-harper"/);
  assert.match(html, /class="corner-art art-oliver"/);
  assert.doesNotMatch(html, /Iris Adultgram[\s\S]{0,80}corner-art/, "Penelope (adult) should have no corner art");
  assert.match(html, /Missing address/, "Harper's empty recipient address should fall back to the literal 'Missing address'");
  assert.match(html, /Apt 3B, Portland, OR, 97201/, "Ringo's 3+-part address should combine parts 2+ onto the second line");
});
