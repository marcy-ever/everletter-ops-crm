import assert from "node:assert/strict";
import test from "node:test";
import { buildRecipientId } from "../lib/ids.ts";
import {
  buildMailings,
  buildRecipients,
  buildSubscribers,
  buildOrders,
  buildSubscriptions,
  buildExceptions,
  buildSummary,
  buildDatasetFromRows,
} from "../lib/build-dataset-from-tables.ts";

const TODAY = "2026-08-12";

test("buildMailings: joins subscription/subscriber/order, computes suggestedShipDate/overdue/dueNext14Days live, extracts orderId from the stable id, uses the mailing's OWN active/notes columns", () => {
  const subscriptionsById = new Map([
    [
      "SUBSCRIPTION-1",
      {
        id: "SUBSCRIPTION-1",
        subscriberId: "SUB-1",
        character: "Marley",
        termType: "Month-to-month",
        status: "Active", // deliberately different from either mailing row's own `active` below
        startedAt: new Date("2026-06-01T00:00:00.000Z"),
        endedAt: null,
        totalLettersExpected: 2,
        recipientName: "Alice Smith",
        addressLine1: "1 Main St",
        addressLine2: null,
        city: null,
        state: null,
        zip: null,
      },
    ],
  ]);
  const subscribersById = new Map([["SUB-1", { id: "SUB-1", email: "alice@example.com", name: "Alice Smith", createdAt: new Date() }]]);
  const ordersById = new Map([["ORD-1", { id: "ORD-1", subscriptionId: "SUBSCRIPTION-1", externalOrderNumber: "1001", amount: null, orderedAt: new Date("2026-06-01T00:00:00.000Z") }]]);
  const mailingRows = [
    {
      id: "ORD-1::Marley::1",
      subscriptionId: "SUBSCRIPTION-1",
      appMailingId: "MAIL-ABC1",
      lastSourceRow: "5",
      letterNumber: 1,
      scheduledDate: "2026-08-20",
      status: "To Prepare",
      active: true,
      notes: null,
      recipientName: "Alice Smith",
      addressLine1: "1 Main St",
      addressLine2: null,
      city: null,
      state: null,
      zip: null,
      stagingLocationId: null,
    },
    {
      id: "ORD-1::Marley::2",
      subscriptionId: "SUBSCRIPTION-1",
      appMailingId: "MAIL-ABC2",
      lastSourceRow: "6",
      letterNumber: 2,
      scheduledDate: "2026-07-01",
      status: "Mailed",
      active: false, // disagrees with the subscription's own "Active" status - this row's own value must win
      notes: "Ashley has them",
      recipientName: "Alice Smith",
      addressLine1: "1 Main St",
      addressLine2: null,
      city: null,
      state: null,
      zip: null,
      stagingLocationId: null,
    },
  ];

  const result = buildMailings(mailingRows, subscriptionsById, subscribersById, ordersById, TODAY);
  const expectedRecipientId = buildRecipientId({ subscriberId: "SUB-1", recipientName: "Alice Smith", address: "1 Main St" });

  assert.equal(result.length, 2);
  // sorted by shipDate ascending: 2026-07-01 before 2026-08-20
  assert.deepEqual(result[0], {
    mailingId: "MAIL-ABC2",
    subscriberId: "SUB-1",
    recipientId: expectedRecipientId,
    orderId: "ORD-1",
    orderDate: "2026-06-01",
    subscriptionId: "SUBSCRIPTION-1",
    recipientName: "Alice Smith",
    email: "alice@example.com",
    character: "Marley",
    plan: "Month-to-month",
    letterNumber: "2",
    shipDate: "2026-07-01",
    suggestedShipDate: "2026-07-01",
    status: "Mailed",
    activeState: "Archived", // this row's own active:false, not the subscription's "Active"
    notes: "Ashley has them",
    overdue: false, // status "Mailed" is not an open status
    dueNext14Days: false,
    sourceRow: 6,
  });
  assert.deepEqual(result[1], {
    mailingId: "MAIL-ABC1",
    subscriberId: "SUB-1",
    recipientId: expectedRecipientId,
    orderId: "ORD-1",
    orderDate: "2026-06-01",
    subscriptionId: "SUBSCRIPTION-1",
    recipientName: "Alice Smith",
    email: "alice@example.com",
    character: "Marley",
    plan: "Month-to-month",
    letterNumber: "1",
    shipDate: "2026-08-20",
    suggestedShipDate: "2026-08-15",
    status: "To Prepare",
    activeState: "Active",
    notes: "",
    overdue: false, // future ship date
    dueNext14Days: true, // 8 days out, within 14
    sourceRow: 5,
  });
});

test("buildMailings: missing order (skipped by write-to-tables) leaves orderDate empty instead of throwing", () => {
  const subscriptionsById = new Map([
    ["SUBSCRIPTION-1", { id: "SUBSCRIPTION-1", subscriberId: "SUB-1", character: "Oliver", termType: "One-time", status: "Active", startedAt: null, endedAt: null, totalLettersExpected: 1, recipientName: "Bob", addressLine1: null, addressLine2: null, city: null, state: null, zip: null }],
  ]);
  const subscribersById = new Map([["SUB-1", { id: "SUB-1", email: "bob@example.com", name: "Bob", createdAt: new Date() }]]);
  const ordersById = new Map(); // order was skipped
  const mailingRows = [
    { id: "ORD-9::Oliver::1", subscriptionId: "SUBSCRIPTION-1", appMailingId: "MAIL-X", lastSourceRow: "10", letterNumber: 1, scheduledDate: "2026-08-12", status: "To Prepare", active: true, notes: null, recipientName: "Bob", addressLine1: null, addressLine2: null, city: null, state: null, zip: null, stagingLocationId: null },
  ];
  const [result] = buildMailings(mailingRows, subscriptionsById, subscribersById, ordersById, TODAY);
  assert.equal(result.orderId, "ORD-9");
  assert.equal(result.orderDate, "");
});

test("buildRecipients: groups subscriptions by (subscriberId, name, address), aggregates characters/totalMailings/nextShipDate from the already-built mailings", () => {
  const subscriptionRows = [
    { id: "S1", subscriberId: "SUB-1", character: "Marley", termType: "Month-to-month", status: "Active", startedAt: null, endedAt: null, totalLettersExpected: 2, recipientName: "Alice Smith", addressLine1: "1 Main St", addressLine2: null, city: null, state: null, zip: null },
    { id: "S2", subscriberId: "SUB-1", character: "Oliver", termType: "6-month", status: "Active", startedAt: null, endedAt: null, totalLettersExpected: 12, recipientName: "Alice Smith", addressLine1: "1 Main St", addressLine2: null, city: null, state: null, zip: null },
  ];
  const recipientId = buildRecipientId({ subscriberId: "SUB-1", recipientName: "Alice Smith", address: "1 Main St" });
  const mailings = [
    { mailingId: "M1", subscriberId: "SUB-1", recipientId, orderId: "O1", orderDate: "", subscriptionId: "S1", recipientName: "Alice Smith", email: "", character: "Marley", plan: "Month-to-month", letterNumber: "1", shipDate: "2026-08-20", suggestedShipDate: "", status: "To Prepare", activeState: "Active", notes: "", overdue: false, dueNext14Days: true, sourceRow: 1 },
    { mailingId: "M2", subscriberId: "SUB-1", recipientId, orderId: "O2", orderDate: "", subscriptionId: "S2", recipientName: "Alice Smith", email: "", character: "Oliver", plan: "6-month", letterNumber: "1", shipDate: "2026-08-10", suggestedShipDate: "", status: "Mailed", activeState: "Active", notes: "", overdue: false, dueNext14Days: false, sourceRow: 2 },
  ];

  const [result] = buildRecipients(subscriptionRows, mailings);
  assert.equal(result.recipientId, recipientId);
  assert.equal(result.subscriberId, "SUB-1");
  assert.equal(result.name, "Alice Smith");
  assert.equal(result.address, "1 Main St");
  assert.deepEqual(result.characters, ["Marley", "Oliver"]); // sorted, distinct
  assert.equal(result.totalMailings, 2); // both mailings count, regardless of status
  assert.equal(result.nextShipDate, "2026-08-20"); // only M1 is Active+open; M2 is "Mailed" (not open)
});

test("buildRecipients: nextShipDate is empty when no mailing is Active+open", () => {
  const subscriptionRows = [
    { id: "S1", subscriberId: "SUB-1", character: "Marley", termType: "Month-to-month", status: "Active", startedAt: null, endedAt: null, totalLettersExpected: 2, recipientName: "Alice", addressLine1: "1 Main St", addressLine2: null, city: null, state: null, zip: null },
  ];
  const recipientId = buildRecipientId({ subscriberId: "SUB-1", recipientName: "Alice", address: "1 Main St" });
  const mailings = [
    { mailingId: "M1", subscriberId: "SUB-1", recipientId, orderId: "O1", orderDate: "", subscriptionId: "S1", recipientName: "Alice", email: "", character: "Marley", plan: "Month-to-month", letterNumber: "1", shipDate: "2026-08-01", suggestedShipDate: "", status: "Mailed", activeState: "Active", notes: "", overdue: false, dueNext14Days: false, sourceRow: 1 },
  ];
  const [result] = buildRecipients(subscriptionRows, mailings);
  assert.equal(result.nextShipDate, "");
});

test("buildSubscribers: status is Active if ANY subscription is Active, firstOrderDate is the earliest orderedAt, issueCount counts that subscriber's exceptions", () => {
  const subscriberRows = [
    { id: "SUB-1", email: "a@example.com", name: "A", createdAt: new Date() },
    { id: "SUB-2", email: "b@example.com", name: "B", createdAt: new Date() },
  ];
  const subscriptionRows = [
    { id: "S1", subscriberId: "SUB-2", character: "Marley", termType: "Month-to-month", status: "Active", startedAt: null, endedAt: null, totalLettersExpected: 2, recipientName: "B1", addressLine1: null, addressLine2: null, city: null, state: null, zip: null },
    { id: "S2", subscriberId: "SUB-2", character: "Oliver", termType: "One-time", status: "Archived", startedAt: null, endedAt: null, totalLettersExpected: 1, recipientName: "B2", addressLine1: null, addressLine2: null, city: null, state: null, zip: null },
  ];
  const orderRows = [
    { id: "O1", subscriptionId: "S1", externalOrderNumber: "1", amount: null, orderedAt: new Date("2026-07-01T00:00:00.000Z") },
    { id: "O2", subscriptionId: "S2", externalOrderNumber: "2", amount: null, orderedAt: new Date("2026-06-01T00:00:00.000Z") }, // earlier
  ];
  const mailings = [];
  const exceptions = [
    { exceptionId: "EX-1", severity: "High", reason: "Missing address", mailingId: "M1", subscriberId: "SUB-2", recipientName: "B1", shipDate: "", suggestedShipDate: "", status: "To Prepare", sourceRow: 1 },
  ];

  const result = buildSubscribers(subscriberRows, subscriptionRows, orderRows, mailings, exceptions);
  const subA = result.find((s) => s.subscriberId === "SUB-1");
  const subB = result.find((s) => s.subscriberId === "SUB-2");

  assert.equal(subA.status, "Archived"); // no subscriptions at all
  assert.equal(subA.firstOrderDate, "");
  assert.equal(subA.issueCount, 0);

  assert.equal(subB.status, "Active"); // S1 is Active even though S2 is Archived
  assert.equal(subB.firstOrderDate, "2026-06-01"); // earliest of the two orders
  assert.equal(subB.issueCount, 1);
});

test("buildOrders: resolves subscriberId/plan via the subscription join, computes billingMonth from createdOn", () => {
  const subscriptionsById = new Map([["S1", { id: "S1", subscriberId: "SUB-1", character: "Marley", termType: "Month-to-month", status: "Active", startedAt: null, endedAt: null, totalLettersExpected: 2, recipientName: "A", addressLine1: null, addressLine2: null, city: null, state: null, zip: null }]]);
  const orderRows = [{ id: "O1", subscriptionId: "S1", externalOrderNumber: "1001", amount: null, orderedAt: new Date("2026-07-21T00:00:00.000Z") }];
  const [result] = buildOrders(orderRows, subscriptionsById);
  assert.deepEqual(result, {
    orderId: "O1",
    subscriberId: "SUB-1",
    sourceOrderNumber: "1001",
    createdOn: "2026-07-21",
    billingMonth: "2026-07",
    plan: "Month-to-month",
    status: "Imported",
    amount: "",
  });
});

test("buildSubscriptions: generatedMailings counts actual mailings for that subscription (not totalLettersExpected), endDate comes from the ended_at column", () => {
  const subscriptionRows = [
    { id: "S1", subscriberId: "SUB-1", character: "Marley", termType: "Month-to-month", status: "Active", startedAt: new Date("2026-06-01T00:00:00.000Z"), endedAt: new Date("2026-12-01T00:00:00.000Z"), totalLettersExpected: 2, recipientName: "A", addressLine1: "1 Main St", addressLine2: null, city: null, state: null, zip: null },
  ];
  const mailings = [
    { mailingId: "M1", subscriberId: "SUB-1", recipientId: "R", orderId: "O1", orderDate: "", subscriptionId: "S1", recipientName: "A", email: "", character: "Marley", plan: "Month-to-month", letterNumber: "1", shipDate: "2026-08-01", suggestedShipDate: "", status: "To Prepare", activeState: "Active", notes: "", overdue: false, dueNext14Days: false, sourceRow: 1 },
  ]; // only 1 of the 2 "expected" letters actually generated this import
  const [result] = buildSubscriptions(subscriptionRows, mailings);
  assert.equal(result.generatedMailings, 1);
  assert.equal(result.endDate, "2026-12-01");
  assert.equal(result.startDate, "2026-06-01");
});

test("buildSubscriptions: endDate is empty when ended_at is null (open-ended subscription)", () => {
  const subscriptionRows = [
    { id: "S1", subscriberId: "SUB-1", character: "Marley", termType: "Month-to-month", status: "Active", startedAt: null, endedAt: null, totalLettersExpected: 2, recipientName: "A", addressLine1: "1 Main St", addressLine2: null, city: null, state: null, zip: null },
  ];
  const [result] = buildSubscriptions(subscriptionRows, []);
  assert.equal(result.endDate, "");
});

test("buildExceptions: mailing-resolvable case joins through to the real mailing's fields", () => {
  const mailingsByStableId = new Map([["ORD-1::Marley::1", { id: "ORD-1::Marley::1", appMailingId: "MAIL-ABC1" }]]);
  const mailingsByAppId = new Map([
    ["MAIL-ABC1", { mailingId: "MAIL-ABC1", subscriberId: "SUB-1", recipientId: "R1", recipientName: "Alice", shipDate: "2026-08-01", suggestedShipDate: "2026-08-01", status: "To Prepare", sourceRow: 5 }],
  ]);
  const subscriptionsById = new Map([["S1", { id: "S1", subscriberId: "SUB-1", recipientName: "Alice", addressLine1: "1 Main St" }]]);
  const exceptionRows = [{ id: 1, subscriptionId: "S1", mailingId: "ORD-1::Marley::1", type: "Ship date is not a 1st/15th batch", reviewed: false, createdAt: new Date(), reviewedAt: null }];

  const [result] = buildExceptions(exceptionRows, mailingsByStableId, mailingsByAppId, subscriptionsById);
  assert.deepEqual(result, {
    exceptionId: "EX-5",
    // severity check is case-sensitive and doesn't match "Ship date" (capital S) against 'ship date' or 'Missing' -> Low.
    // suggestedShipDate's check IS case-insensitive (reason.toLowerCase().includes('ship date')) and does match -> populated.
    // Both asymmetric case-sensitivities are copied exactly from app.js's own two checks - not a typo.
    severity: "Low",
    reason: "Ship date is not a 1st/15th batch",
    mailingId: "MAIL-ABC1",
    subscriberId: "SUB-1",
    recipientName: "Alice",
    shipDate: "2026-08-01",
    suggestedShipDate: "2026-08-01",
    status: "To Prepare",
    sourceRow: 5,
  });
});

test("buildExceptions: subscription-only fallback case (mailing was skipped) recovers what it can and clearly marks the rest as unrecoverable", () => {
  const mailingsByStableId = new Map();
  const mailingsByAppId = new Map();
  const subscriptionsById = new Map([["S1", { id: "S1", subscriberId: "SUB-1", recipientName: "Bob", addressLine1: null }]]);
  const exceptionRows = [{ id: 42, subscriptionId: "S1", mailingId: null, type: "Missing ship date", reviewed: false, createdAt: new Date(), reviewedAt: null }];

  const [result] = buildExceptions(exceptionRows, mailingsByStableId, mailingsByAppId, subscriptionsById);
  assert.deepEqual(result, {
    exceptionId: "EX-DB-42",
    severity: "High", // contains "Missing"
    reason: "Missing ship date",
    mailingId: "",
    subscriberId: "SUB-1",
    recipientName: "Bob",
    shipDate: "",
    suggestedShipDate: "",
    status: "",
    sourceRow: "",
  });
});

test("buildSummary: counts and live-computed overdue/dueNext14 aggregates match the mailings passed in", () => {
  const mailingsOut = [
    { mailingId: "M1", subscriberId: "S1", recipientId: "R1", orderId: "O1", orderDate: "", subscriptionId: "SUB1", recipientName: "", email: "", character: "", plan: "", letterNumber: "", shipDate: "2026-08-01", suggestedShipDate: "", status: "To Prepare", activeState: "Active", notes: "", overdue: true, dueNext14Days: false, sourceRow: 1 },
    { mailingId: "M2", subscriberId: "S1", recipientId: "R1", orderId: "O1", orderDate: "", subscriptionId: "SUB1", recipientName: "", email: "", character: "", plan: "", letterNumber: "", shipDate: "2026-08-20", suggestedShipDate: "", status: "To Prepare", activeState: "Active", notes: "", overdue: false, dueNext14Days: true, sourceRow: 2 },
    { mailingId: "M3", subscriberId: "S1", recipientId: "R1", orderId: "O1", orderDate: "", subscriptionId: "SUB1", recipientName: "", email: "", character: "", plan: "", letterNumber: "", shipDate: "2026-08-01", suggestedShipDate: "", status: "Mailed", activeState: "Archived", notes: "", overdue: false, dueNext14Days: false, sourceRow: 3 },
  ];
  const subscribersOut = [{ subscriberId: "S1", email: "", displayName: "", status: "Active", firstOrderDate: "", openMailings: 2, totalMailings: 3, nextShipDate: "2026-08-01", issueCount: 1 }];
  const exceptionsOut = [{ exceptionId: "EX-1", severity: "High", reason: "Missing ship date", mailingId: "M1", subscriberId: "S1", recipientName: "", shipDate: "", suggestedShipDate: "", status: "", sourceRow: 1 }];

  const summary = buildSummary(subscribersOut, [], [], [], mailingsOut, exceptionsOut, "test.xlsx", TODAY);
  assert.equal(summary.asOf, TODAY);
  assert.equal(summary.sourceFile, "test.xlsx");
  assert.equal(summary.mailingCount, 3);
  assert.equal(summary.openMailingCount, 2); // M1, M2 are Active + open status; M3 is Archived
  assert.equal(summary.archivedMailingCount, 1);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.dueNext14Count, 1);
  assert.equal(summary.exceptionCount, 1);
  assert.equal(summary.missingShipDateCount, 1);
});

test("buildDatasetFromRows: composes all seven entities and returns automationRules as an empty array", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");
  const subscriberRows = [{ id: "SUB-1", email: "a@example.com", name: "Alice", createdAt: new Date() }];
  const subscriptionRows = [{ id: "S1", subscriberId: "SUB-1", character: "Marley", termType: "Month-to-month", status: "Active", startedAt: new Date("2026-06-01T00:00:00.000Z"), endedAt: null, totalLettersExpected: 2, recipientName: "Alice", addressLine1: "1 Main St", addressLine2: null, city: null, state: null, zip: null }];
  const orderRows = [{ id: "O1", subscriptionId: "S1", externalOrderNumber: "1001", amount: null, orderedAt: new Date("2026-06-01T00:00:00.000Z") }];
  const mailingRows = [
    { id: "O1::Marley::1", subscriptionId: "S1", appMailingId: "MAIL-1", lastSourceRow: "5", letterNumber: 1, scheduledDate: "2026-08-01", status: "To Prepare", active: true, notes: null, recipientName: "Alice", addressLine1: "1 Main St", addressLine2: null, city: null, state: null, zip: null, stagingLocationId: null },
  ];
  const exceptionRows = [];

  const dataset = buildDatasetFromRows({ subscriberRows, subscriptionRows, orderRows, mailingRows, exceptionRows, now, sourceFile: "test.xlsx" });

  assert.equal(dataset.summary.mailingCount, 1);
  assert.equal(dataset.subscribers.length, 1);
  assert.equal(dataset.recipients.length, 1);
  assert.equal(dataset.orders.length, 1);
  assert.equal(dataset.subscriptions.length, 1);
  assert.equal(dataset.mailings.length, 1);
  assert.equal(dataset.exceptions.length, 0);
  assert.deepEqual(dataset.automationRules, []);
  assert.equal(dataset.summary.asOf, "2026-08-12");
});
