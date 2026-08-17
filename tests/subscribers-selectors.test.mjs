// Coverage for app/crm/views/subscribers/subscribers-selectors.ts - Phase
// 1 step 12 (CLAUDE.md), the largest view migrated so far. Two derivation
// functions, tested separately, matching the view's own two panes.
import assert from "node:assert/strict";
import test from "node:test";
import { computeSubscriberProfile, computeSubscriberRows, printedEnvelopeStatusForMailing, selectSubscriber } from "../app/crm/views/subscribers/subscribers-selectors.ts";

function subscriber(overrides = {}) {
  return {
    subscriberId: "SUB-1",
    email: "ava@example.test",
    displayName: "Ava Example",
    status: "Active",
    firstOrderDate: "2026-01-01",
    openMailings: 1,
    totalMailings: 1,
    nextShipDate: "2026-08-15",
    issueCount: 0,
    ...overrides,
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
    plan: "Month-to-month",
    letterNumber: "1",
    shipDate: "2026-08-15",
    suggestedShipDate: "2026-08-15",
    status: "To Prepare",
    activeState: "Active",
    notes: "",
    overdue: false,
    dueNext14Days: true,
    sourceRow: 2,
    ...overrides,
  };
}

function seedWith({ subscribers = [], mailings = [] } = {}) {
  return { subscribers, recipients: [], subscriptions: [], orders: [], mailings, exceptions: [], automationRules: [], summary: {} };
}

test("computeSubscriberRows searches displayName/email/subscriberId/status/openMailings, and only those fields", () => {
  const sub = subscriber();
  const seed = seedWith({ subscribers: [sub] });
  for (const query of ["Ava Example", "ava@example.test", "SUB-1", "Active", "1"]) {
    assert.deepEqual(computeSubscriberRows(seed, query), [sub], `query "${query}" should match`);
  }
  // firstOrderDate/issueCount/nextShipDate aren't in the searched field
  // list - a query matching only those should find nothing.
  assert.deepEqual(computeSubscriberRows(seed, "2026-01-01"), []);
});

test("computeSubscriberRows caps at 80 rows", () => {
  const subs = Array.from({ length: 90 }, (_, i) => subscriber({ subscriberId: `SUB-${i}`, displayName: `Person ${i}` }));
  const seed = seedWith({ subscribers: subs });
  assert.equal(computeSubscriberRows(seed, "").length, 80);
});

test("selectSubscriber prefers the previously-selected subscriber if still in the row list", () => {
  const a = subscriber({ subscriberId: "SUB-A" });
  const b = subscriber({ subscriberId: "SUB-B" });
  assert.equal(selectSubscriber([a, b], "SUB-B"), b);
});

test("selectSubscriber falls back to the first row when the previous selection isn't in the list (e.g. filtered out by search)", () => {
  const a = subscriber({ subscriberId: "SUB-A" });
  const b = subscriber({ subscriberId: "SUB-B" });
  assert.equal(selectSubscriber([a, b], "SUB-DOES-NOT-EXIST"), a);
});

test("selectSubscriber returns null when there are no rows at all", () => {
  assert.equal(selectSubscriber([], "SUB-A"), null);
});

test("computeSubscriberProfile only includes mailings for the given subscriber, sorted by ship date then letter number", () => {
  const sub = subscriber();
  const other = subscriber({ subscriberId: "SUB-OTHER" });
  const seed = seedWith({
    subscribers: [sub, other],
    mailings: [
      mailing({ mailingId: "MAIL-3", shipDate: "2026-09-01", letterNumber: "3" }),
      mailing({ mailingId: "MAIL-1", shipDate: "2026-08-15", letterNumber: "1" }),
      mailing({ mailingId: "MAIL-2", shipDate: "2026-08-15", letterNumber: "2" }),
      mailing({ mailingId: "MAIL-OTHER", subscriberId: "SUB-OTHER" }),
    ],
  });
  const data = computeSubscriberProfile(seed, {}, new Set(), {}, sub);
  assert.deepEqual(
    data.openRows.map((row) => row.mailingId),
    ["MAIL-1", "MAIL-2", "MAIL-3"],
  );
  assert.equal(data.totalMailings, 3);
});

test("computeSubscriberProfile's openRows exclude Mailed and inactive mailings, but totalMailings/recipientCount count everything", () => {
  const sub = subscriber();
  const seed = seedWith({
    subscribers: [sub],
    mailings: [
      mailing({ mailingId: "MAIL-OPEN", status: "To Prepare", activeState: "Active" }),
      mailing({ mailingId: "MAIL-MAILED", status: "Mailed", activeState: "Active" }),
      mailing({ mailingId: "MAIL-INACTIVE", status: "To Prepare", activeState: "Archived" }),
    ],
  });
  const data = computeSubscriberProfile(seed, {}, new Set(), {}, sub);
  assert.deepEqual(
    data.openRows.map((row) => row.mailingId),
    ["MAIL-OPEN"],
  );
  assert.equal(data.totalMailings, 3, "totalMailings counts every mailing for this subscriber, not just open ones");
});

test("computeSubscriberProfile's openRows carry envelopeStatus (from the shared componentStatus selector) and envelopeQuantity", () => {
  const sub = subscriber();
  const seed = seedWith({ subscribers: [sub], mailings: [mailing()] });
  const data = computeSubscriberProfile(seed, {}, new Set(), {}, sub);
  assert.equal(data.openRows.length, 1);
  assert.equal(typeof data.openRows[0].envelopeStatus, "string");
  assert.equal(typeof data.openRows[0].envelopeQuantity, "number");
});

test("computeSubscriberProfile's totalEnvelopeCount sums envelopeQuantity across open rows only", () => {
  const sub = subscriber();
  const seed = seedWith({
    subscribers: [sub],
    mailings: [mailing({ mailingId: "MAIL-1", plan: "12-month" }), mailing({ mailingId: "MAIL-2", status: "Mailed" })],
  });
  const data = computeSubscriberProfile(seed, {}, new Set(), {}, sub);
  const expected = data.openRows.reduce((total, row) => total + row.envelopeQuantity, 0);
  assert.equal(data.totalEnvelopeCount, expected);
  assert.equal(data.openRows.length, 1, "the Mailed row must be excluded from the sum, not just from display");
});

test("computeSubscriberProfile's recipientCount is the number of distinct recipients across ALL mailings, open or not", () => {
  const sub = subscriber();
  const seed = seedWith({
    subscribers: [sub],
    mailings: [
      mailing({ mailingId: "MAIL-1", recipientId: "REC-A" }),
      mailing({ mailingId: "MAIL-2", recipientId: "REC-A" }),
      mailing({ mailingId: "MAIL-3", recipientId: "REC-B", status: "Mailed" }),
    ],
  });
  const data = computeSubscriberProfile(seed, {}, new Set(), {}, sub);
  assert.equal(data.recipientCount, 2);
});

test("printedEnvelopeStatusForMailing: 'Printed' for a single envelope, 'Both Printed' for more than one", () => {
  assert.equal(printedEnvelopeStatusForMailing({ envelopeQuantity: 1 }), "Printed");
  assert.equal(printedEnvelopeStatusForMailing({ envelopeQuantity: 2 }), "Both Printed");
});
