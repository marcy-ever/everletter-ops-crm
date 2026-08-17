import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSyncPreview,
  defaultSyncSubscriberId,
  defaultSyncSubscriptionId,
} from "../app/crm/views/sync/sync-selectors.ts";

// New coverage from Phase 1 step 8 (CLAUDE.md) - getSyncPreview()/
// renderSync()'s default-subscriber logic and preview computation had
// never been unit tested before (only indirectly through the sync
// render-snapshot). Also proves the view is deterministic with zero clock
// dependency at all - batchDatesForOrder() (lib/domain/batch-dates.ts)
// derives every date from `orderDate` itself, never from `new Date()`.

function subscriber(overrides = {}) {
  return {
    subscriberId: "sub1",
    email: "ava@example.test",
    displayName: "Ava Example",
    status: "Active",
    firstOrderDate: "2026-01-01",
    openMailings: 0,
    totalMailings: 0,
    nextShipDate: "",
    issueCount: 0,
    ...overrides,
  };
}

function subscription(overrides = {}) {
  return {
    subscriptionId: "sn1",
    subscriberId: "sub1",
    recipientId: "rec1",
    plan: "Month-to-month",
    character: "Marley",
    startDate: "2026-01-01",
    endDate: "",
    activeState: "Active",
    generatedMailings: 0,
    ...overrides,
  };
}

function recipient(overrides = {}) {
  return {
    recipientId: "rec1",
    subscriberId: "sub1",
    name: "Ava Example",
    address: "1 Main St",
    characters: ["Marley"],
    totalMailings: 0,
    nextShipDate: "",
    ...overrides,
  };
}

function mailing(overrides = {}) {
  return {
    mailingId: "m1",
    subscriberId: "sub1",
    recipientId: "rec1",
    orderId: "o1",
    orderDate: "2026-07-01",
    subscriptionId: "sn1",
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
    dueNext14Days: false,
    sourceRow: 2,
    ...overrides,
  };
}

function seedWith({ subscribers = [], subscriptions = [], recipients = [], mailings = [] } = {}) {
  return {
    summary: {
      asOf: "2026-08-12",
      sourceFile: "test",
      subscriberCount: subscribers.length,
      activeSubscriberCount: 0,
      archivedSubscriberCount: 0,
      recipientCount: recipients.length,
      orderCount: 0,
      subscriptionCount: subscriptions.length,
      mailingCount: mailings.length,
      openMailingCount: 0,
      archivedMailingCount: 0,
      overdueCount: 0,
      dueNext14Count: 0,
      exceptionCount: 0,
      missingShipDateCount: 0,
    },
    subscribers,
    recipients,
    orders: [],
    subscriptions,
    mailings,
    exceptions: [],
    automationRules: [],
  };
}

test("defaultSyncSubscriberId picks the first Active subscriber, ignoring Archived ones", () => {
  const archived = subscriber({ subscriberId: "sub1", status: "Archived" });
  const active = subscriber({ subscriberId: "sub2", status: "Active" });
  const seed = seedWith({ subscribers: [archived, active] });
  assert.equal(defaultSyncSubscriberId(seed), "sub2");
});

test("defaultSyncSubscriberId falls back to the very first subscriber when none are Active", () => {
  const a = subscriber({ subscriberId: "sub1", status: "Archived" });
  const b = subscriber({ subscriberId: "sub2", status: "Archived" });
  const seed = seedWith({ subscribers: [a, b] });
  assert.equal(defaultSyncSubscriberId(seed), "sub1");
});

test("defaultSyncSubscriptionId picks the subscriber's first subscription, or '' if they have none", () => {
  const sub = subscriber();
  const sn1 = subscription({ subscriptionId: "sn1", subscriberId: "sub1" });
  const sn2 = subscription({ subscriptionId: "sn2", subscriberId: "sub1" });
  const seed = seedWith({ subscribers: [sub], subscriptions: [sn1, sn2] });
  assert.equal(defaultSyncSubscriptionId("sub1", seed), "sn1");
  assert.equal(defaultSyncSubscriptionId("no-such-subscriber", seed), "");
});

test("computeSyncPreview resolves the requested subscriber/subscription, and computes existingCount/currentMax from real mailings", () => {
  const sub = subscriber();
  const sn = subscription();
  const rec = recipient();
  const m1 = mailing({ mailingId: "m1", subscriptionId: "sn1", letterNumber: "1" });
  const m2 = mailing({ mailingId: "m2", subscriptionId: "sn1", letterNumber: "3" });
  const seed = seedWith({ subscribers: [sub], subscriptions: [sn], recipients: [rec], mailings: [m1, m2] });

  const data = computeSyncPreview(seed, "sub1", "sn1", "Month-to-month", "2026-08-01");
  assert.equal(data.subscriber.subscriberId, "sub1");
  assert.equal(data.subscription.subscriptionId, "sn1");
  assert.equal(data.existingCount, 2);
  assert.equal(data.currentMax, 3, "currentMax is the highest existing letterNumber, not the count");
});

test("computeSyncPreview: newCount comes from plannedLetterCount(plan), and generated rows continue the letter sequence from currentMax", () => {
  const sub = subscriber();
  const sn = subscription();
  const rec = recipient();
  const existing = mailing({ mailingId: "m1", subscriptionId: "sn1", letterNumber: "1" });
  const seed = seedWith({ subscribers: [sub], subscriptions: [sn], recipients: [rec], mailings: [existing] });

  const data = computeSyncPreview(seed, "sub1", "sn1", "Month-to-month", "2026-08-01");
  assert.equal(data.newCount, 2, "Month-to-month plans 2 letters");
  assert.equal(data.generated.length, 2);
  assert.deepEqual(data.generated.map((row) => row.letterNumber), [2, 3], "continues after currentMax (1), not restarting at 1");
  for (const row of data.generated) {
    assert.equal(row.mailingId, `SIM-sn1-${row.shipDate.replaceAll("-", "")}-L${row.letterNumber}`);
  }
});

test("computeSyncPreview: subscriberOptions only includes Active subscribers, capped at 120, with the correct one marked selected", () => {
  const active1 = subscriber({ subscriberId: "sub1", status: "Active", displayName: "Ava Example", email: "ava@example.test" });
  const active2 = subscriber({ subscriberId: "sub2", status: "Active", displayName: "Ben Example", email: "" });
  const archived = subscriber({ subscriberId: "sub3", status: "Archived" });
  const sn = subscription({ subscriptionId: "sn1", subscriberId: "sub1" });
  const rec = recipient();
  const seed = seedWith({ subscribers: [active1, active2, archived], subscriptions: [sn], recipients: [rec] });

  const data = computeSyncPreview(seed, "sub1", "sn1", "Month-to-month", "2026-08-01");
  assert.equal(data.subscriberOptions.length, 2, "archived subscriber excluded");
  assert.deepEqual(
    data.subscriberOptions.map((opt) => opt.value),
    ["sub1", "sub2"],
  );
  assert.equal(data.subscriberOptions[0].selected, true);
  assert.equal(data.subscriberOptions[1].selected, false);
  // Mojibake separator (U+00C2 U+00B7) preserved exactly, matching the
  // legacy template literal's own output - not a real middot, and not
  // fixed here on purpose (see this module's own header).
  assert.equal(data.subscriberOptions[0].label, "Ava Example Â· ava@example.test");
  assert.equal(data.subscriberOptions[1].label, "Ben Example Â· sub2", "falls back to the subscriberId when email is blank");
});

test("computeSyncPreview: subscriptionOptions label each option as recipient · character · plan, with the correct one selected", () => {
  const sub = subscriber();
  const sn1 = subscription({ subscriptionId: "sn1", character: "Marley", plan: "Month-to-month" });
  const sn2 = subscription({ subscriptionId: "sn2", character: "Ringo", plan: "6-month" });
  const rec = recipient({ name: "Ava Example" });
  const seed = seedWith({ subscribers: [sub], subscriptions: [sn1, sn2], recipients: [rec] });

  const data = computeSyncPreview(seed, "sub1", "sn2", "Month-to-month", "2026-08-01");
  assert.equal(data.subscriptionOptions.length, 2);
  assert.equal(data.subscriptionOptions[0].label, "Ava Example Â· Marley Â· Month-to-month");
  assert.equal(data.subscriptionOptions[1].label, "Ava Example Â· Ringo Â· 6-month");
  assert.equal(data.subscriptionOptions[0].selected, false);
  assert.equal(data.subscriptionOptions[1].selected, true);
});

test("computeSyncPreview is deterministic - same inputs, same output, called twice", () => {
  const sub = subscriber();
  const sn = subscription();
  const rec = recipient();
  const seed = seedWith({ subscribers: [sub], subscriptions: [sn], recipients: [rec] });

  const a = computeSyncPreview(seed, "sub1", "sn1", "12-month", "2026-08-01");
  const b = computeSyncPreview(seed, "sub1", "sn1", "12-month", "2026-08-01");
  assert.deepEqual(a, b);
});
