import assert from "node:assert/strict";
import test from "node:test";
import {
  activeExceptions,
  availableBatchDates,
  componentStatus,
  defaultComponentStatus,
  effectiveMailing,
  effectiveMailings,
  exceptionsForMailing,
  findSubscriptionMailings,
  getRecipient,
  getRecipientName,
  getSubscriberSubscriptions,
  includesText,
  isExceptionReviewed,
  nextBatchDate,
  packetProblemRows,
  packetRows,
  pastBatchDates,
  qaIsReady,
  qaNeedsAttention,
  selectedBatchDate,
} from "../lib/client/selectors.ts";
import { exceptionReviewKey, mailingKey } from "../lib/domain/keys.ts";

// New coverage from step 4 of the app.js decomposition (lib/client/selectors.ts
// didn't exist before this - extracted from app/crm/legacy-app.js, see that
// module's own header and this step's PR description). These functions are
// pure now, taking every input explicitly, which is what makes them testable
// here instead of only indirectly through the render-snapshot suite.

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

function exception(overrides = {}) {
  return {
    exceptionId: "e1",
    severity: "High",
    reason: "Missing email",
    mailingId: "m1",
    subscriberId: "sub1",
    recipientName: "Ava Example",
    shipDate: "2026-08-15",
    suggestedShipDate: "2026-08-15",
    status: "To Prepare",
    sourceRow: 2,
    ...overrides,
  };
}

function seedWith({ mailings = [], exceptions = [], subscriptions = [], recipients = [] } = {}) {
  return {
    summary: {
      asOf: "2026-08-12",
      sourceFile: "test",
      subscriberCount: 0,
      activeSubscriberCount: 0,
      archivedSubscriberCount: 0,
      recipientCount: 0,
      orderCount: 0,
      subscriptionCount: 0,
      mailingCount: mailings.length,
      openMailingCount: 0,
      archivedMailingCount: 0,
      overdueCount: 0,
      dueNext14Count: 0,
      exceptionCount: exceptions.length,
      missingShipDateCount: 0,
    },
    subscribers: [],
    recipients,
    orders: [],
    subscriptions,
    mailings,
    exceptions,
    automationRules: [],
  };
}

test("effectiveMailing falls through to the mailing's own status when no override exists, and to the override when one does", () => {
  const m = mailing({ status: "To Prepare" });
  const noOverride = effectiveMailing(m, {});
  assert.equal(noOverride.status, "To Prepare");
  assert.equal(noOverride.originalStatus, "To Prepare");

  const withOverride = effectiveMailing(m, { [mailingKey(m)]: "Mailed" });
  assert.equal(withOverride.status, "Mailed");
  assert.equal(withOverride.originalStatus, "To Prepare", "originalStatus always reflects the mailing's own status, override or not");
});

test("effectiveMailings maps effectiveMailing over every mailing in the seed", () => {
  const m1 = mailing({ mailingId: "m1", sourceRow: 2, status: "To Prepare" });
  const m2 = mailing({ mailingId: "m2", sourceRow: 3, status: "Printing" });
  const seed = seedWith({ mailings: [m1, m2] });
  const result = effectiveMailings(seed, { [mailingKey(m2)]: "Mailed" });
  assert.equal(result[0].status, "To Prepare");
  assert.equal(result[1].status, "Mailed");
});

test("isExceptionReviewed matches either by exceptionReviewKey or by raw exceptionId", () => {
  const item = exception();
  assert.equal(isExceptionReviewed(item, new Set()), false);
  assert.equal(isExceptionReviewed(item, new Set([exceptionReviewKey(item)])), true);
  assert.equal(isExceptionReviewed(item, new Set([item.exceptionId])), true);
  assert.equal(isExceptionReviewed(item, new Set(["something-else"])), false);
});

test("activeExceptions filters out reviewed exceptions, by either matching mechanism", () => {
  const reviewedByKey = exception({ exceptionId: "e1", reason: "Missing email" });
  const reviewedById = exception({ exceptionId: "e2", mailingId: "m2", reason: "Missing address" });
  const unreviewed = exception({ exceptionId: "e3", mailingId: "m3", reason: "Missing recipient" });
  const seed = seedWith({ exceptions: [reviewedByKey, reviewedById, unreviewed] });
  const reviewed = new Set([exceptionReviewKey(reviewedByKey), "e2"]);
  assert.deepEqual(activeExceptions(seed, reviewed), [unreviewed]);
});

test("exceptionsForMailing returns only active exceptions matching the given mailing's id", () => {
  const forM1 = exception({ exceptionId: "e1", mailingId: "m1" });
  const forM2 = exception({ exceptionId: "e2", mailingId: "m2" });
  const seed = seedWith({ exceptions: [forM1, forM2] });
  assert.deepEqual(exceptionsForMailing({ mailingId: "m1" }, seed, new Set()), [forM1]);
});

test("defaultComponentStatus: 'payment'/'qa' depend on whether the mailing has an active High-severity exception", () => {
  const m = mailing({ mailingId: "m1", plan: "Month-to-month" });
  const highIssue = exception({ mailingId: "m1", severity: "High" });
  const seedClean = seedWith({ mailings: [m], exceptions: [] });
  const seedWithIssue = seedWith({ mailings: [m], exceptions: [highIssue] });

  assert.equal(defaultComponentStatus(m, "payment", seedClean, new Set()), "Active");
  assert.equal(defaultComponentStatus(m, "payment", seedWithIssue, new Set()), "Needs Check");
  assert.equal(defaultComponentStatus(m, "qa", seedClean, new Set()), "Open");
  assert.equal(defaultComponentStatus(m, "qa", seedWithIssue, new Set()), "Problem");
});

test("defaultComponentStatus: 'envelope'/'letter'/'location' depend on whether the plan is prepaid bulk (6/12-month)", () => {
  const monthly = mailing({ plan: "Month-to-month" });
  const prepaid = mailing({ plan: "12-month" });
  const seed = seedWith({ mailings: [monthly, prepaid] });

  assert.equal(defaultComponentStatus(monthly, "envelope", seed, new Set()), "Need Print");
  assert.equal(defaultComponentStatus(prepaid, "envelope", seed, new Set()), "In Ashley Box");
  assert.equal(defaultComponentStatus(monthly, "letter", seed, new Set()), "Need Print");
  assert.equal(defaultComponentStatus(prepaid, "letter", seed, new Set()), "Stuffed");
  assert.equal(defaultComponentStatus(monthly, "location", seed, new Set()), "Marcy");
  assert.equal(defaultComponentStatus(prepaid, "location", seed, new Set()), "Ashley");
});

test("defaultComponentStatus: 'insert' only applies to marley/oliver, everything else is Not Needed", () => {
  const seed = seedWith();
  assert.equal(defaultComponentStatus(mailing({ character: "Marley" }), "insert", seed, new Set()), "Need Check");
  assert.equal(defaultComponentStatus(mailing({ character: "Oliver" }), "insert", seed, new Set()), "Need Check");
  assert.equal(defaultComponentStatus(mailing({ character: "Ringo" }), "insert", seed, new Set()), "Not Needed");
});

test("componentStatus: an explicit override wins over the computed default", () => {
  const m = mailing({ mailingId: "m1", sourceRow: 2, plan: "Month-to-month" });
  const seed = seedWith({ mailings: [m] });
  assert.equal(componentStatus(m, "envelope", seed, new Set(), {}), "Need Print");
  const key = `${m.mailingId}::${m.sourceRow}::envelope`;
  assert.equal(componentStatus(m, "envelope", seed, new Set(), { [key]: "Printed" }), "Printed");
});

test("componentStatus depends on more than componentOverrides alone: a High exception changes the default it falls back to, with no override set at all", () => {
  const m = mailing({ mailingId: "m1", plan: "Month-to-month" });
  const clean = seedWith({ mailings: [m], exceptions: [] });
  const flagged = seedWith({ mailings: [m], exceptions: [exception({ mailingId: "m1", severity: "High" })] });
  assert.equal(componentStatus(m, "payment", clean, new Set(), {}), "Active");
  assert.equal(componentStatus(m, "payment", flagged, new Set(), {}), "Needs Check");
});

// New coverage from Phase 1 step 14 (Mailing QA - CLAUDE.md): qaIsReady/
// qaNeedsAttention moved here from app/crm/legacy-app.js, since Batch
// Packet's still-legacy packetFinalRow() needs the exact same
// classification QA's own rows do - see this module's own header for why
// that makes these two shared selectors rather than QA-view-only ones.

test("qaIsReady is true only when every one of the six gating fields is in an acceptable state, all defaults, no overrides", () => {
  // A prepaid (12-month) mailing's defaults: envelope "In Ashley Box",
  // letter "Stuffed", location "Ashley" (irrelevant to qaIsReady), payment
  // "Active", artifact/insert default "Need Check" (character isn't
  // marley/oliver here, so insert defaults to "Not Needed" - only artifact
  // needs an explicit override to reach "Packed"), qa defaults to "Open"
  // (not "Ready") - so this mailing needs qa forced to "Ready" and
  // artifact forced to "Packed" before qaIsReady can be true.
  const m = mailing({ mailingId: "m1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  assert.equal(qaIsReady(m, seed, new Set(), {}), false, "qa defaults to Open and artifact defaults to Need Check - not ready yet");

  const artifactKey = `${m.mailingId}::${m.sourceRow}::artifact`;
  const qaKey = `${m.mailingId}::${m.sourceRow}::qa`;
  assert.equal(qaIsReady(m, seed, new Set(), { [artifactKey]: "Packed", [qaKey]: "Ready" }), true);
});

test("qaIsReady is false the instant any one of the six gating fields regresses, even if every other field is ready", () => {
  const m = mailing({ mailingId: "m1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [m] });
  const readyOverrides = {
    [`${m.mailingId}::${m.sourceRow}::artifact`]: "Packed",
    [`${m.mailingId}::${m.sourceRow}::qa`]: "Ready",
  };
  assert.equal(qaIsReady(m, seed, new Set(), readyOverrides), true, "sanity check: fully ready first");
  assert.equal(
    qaIsReady(m, seed, new Set(), { ...readyOverrides, [`${m.mailingId}::${m.sourceRow}::payment`]: "CC Failed" }),
    false,
    "a single regressed field (payment) is enough to flip qaIsReady back to false",
  );
});

test("qaNeedsAttention is true when any of the seven component fields sits in an attention-needing status, false when every field is settled", () => {
  const needsAttention = mailing({ mailingId: "m1", plan: "12-month", character: "Ringo" });
  const seed = seedWith({ mailings: [needsAttention] });
  assert.equal(qaNeedsAttention(needsAttention, seed, new Set(), {}), true, "defaults alone include artifact: Need Check and qa: Open");

  const settled = mailing({ mailingId: "m2", plan: "12-month", character: "Ringo", sourceRow: 3 });
  const settledOverrides = {
    [`${settled.mailingId}::${settled.sourceRow}::payment`]: "Active",
    [`${settled.mailingId}::${settled.sourceRow}::envelope`]: "In Ashley Box",
    [`${settled.mailingId}::${settled.sourceRow}::letter`]: "Stuffed",
    [`${settled.mailingId}::${settled.sourceRow}::artifact`]: "Packed",
    [`${settled.mailingId}::${settled.sourceRow}::insert`]: "Not Needed",
    [`${settled.mailingId}::${settled.sourceRow}::location`]: "Ashley",
    [`${settled.mailingId}::${settled.sourceRow}::qa`]: "Ready",
  };
  assert.equal(qaNeedsAttention(settled, seed, new Set(), settledOverrides), false);
});

test("qaIsReady/qaNeedsAttention depend on more than componentOverrides alone, same as componentStatus itself: a High exception changes the computed defaults both read", () => {
  const m = mailing({ mailingId: "m1", plan: "12-month", character: "Ringo" });
  const clean = seedWith({ mailings: [m], exceptions: [] });
  const flagged = seedWith({ mailings: [m], exceptions: [exception({ mailingId: "m1", severity: "High" })] });
  // A High exception flips payment's default to "Needs Check" and qa's
  // default to "Problem" - both are attention-needing statuses, and
  // "Needs Check" also fails qaIsReady's payment === "Active" check.
  assert.equal(qaNeedsAttention(m, clean, new Set(), {}), true, "already true from artifact/qa defaults alone");
  assert.equal(qaNeedsAttention(m, flagged, new Set(), {}), true);
  assert.equal(qaIsReady(m, clean, new Set(), {}), false);
  assert.equal(qaIsReady(m, flagged, new Set(), {}), false);
});

test("availableBatchDates only includes Active, open-status mailings with a real ship date on or after today, sorted ascending", () => {
  const mailings = [
    { activeState: "Active", status: "To Prepare", shipDate: "2026-09-01" },
    { activeState: "Active", status: "To Prepare", shipDate: "2026-08-15" },
    { activeState: "Active", status: "To Prepare", shipDate: "2026-07-01" }, // past
    { activeState: "Active", status: "Mailed", shipDate: "2026-08-15" }, // not open
    { activeState: "Archived", status: "To Prepare", shipDate: "2026-08-15" }, // not active
    { activeState: "Active", status: "To Prepare", shipDate: "" }, // no ship date
  ];
  assert.deepEqual(availableBatchDates(mailings, "2026-08-01"), ["2026-08-15", "2026-09-01"]);
});

test("pastBatchDates only includes Active mailings with a ship date before today, sorted descending", () => {
  const mailings = [
    { activeState: "Active", status: "Mailed", shipDate: "2026-07-01" },
    { activeState: "Active", status: "Mailed", shipDate: "2026-06-15" },
    { activeState: "Active", status: "To Prepare", shipDate: "2026-09-01" }, // future
    { activeState: "Archived", status: "Mailed", shipDate: "2026-07-01" }, // not active
  ];
  assert.deepEqual(pastBatchDates(mailings, "2026-08-01"), ["2026-07-01", "2026-06-15"]);
});

test("nextBatchDate picks the earliest available date on/after today", () => {
  const mailings = [
    { activeState: "Active", status: "To Prepare", shipDate: "2026-09-01" },
    { activeState: "Active", status: "To Prepare", shipDate: "2026-08-15" },
  ];
  assert.equal(nextBatchDate(mailings, "2026-08-01"), "2026-08-15");
});

test("nextBatchDate returns '' when today is later than every available date - availableBatchDates() already excludes anything before today, so there is nothing left to fall back to", () => {
  const mailings = [
    { activeState: "Active", status: "To Prepare", shipDate: "2026-09-01" },
    { activeState: "Active", status: "To Prepare", shipDate: "2026-08-15" },
  ];
  assert.equal(nextBatchDate(mailings, "2026-10-01"), "");
});

test("nextBatchDate returns '' when there are no available batch dates at all", () => {
  assert.equal(nextBatchDate([], "2026-08-01"), "");
});

test("selectedBatchDate: 'next' resolves via nextBatchDate, 'all' means no filter, anything else passes through as a literal date", () => {
  const mailings = [{ activeState: "Active", status: "To Prepare", shipDate: "2026-08-15" }];
  assert.equal(selectedBatchDate("next", mailings, "2026-08-01"), "2026-08-15");
  assert.equal(selectedBatchDate("all", mailings, "2026-08-01"), "");
  assert.equal(selectedBatchDate("2026-09-01", mailings, "2026-08-01"), "2026-09-01");
});

test("findSubscriptionMailings/getSubscriberSubscriptions/getRecipientName/getRecipient look up by id within the given seed", () => {
  const m1 = mailing({ mailingId: "m1", subscriptionId: "sn1" });
  const m2 = mailing({ mailingId: "m2", subscriptionId: "sn2" });
  const subA = { subscriptionId: "sn1", subscriberId: "sub1", recipientId: "rec1", plan: "Month-to-month", character: "Marley", startDate: "", endDate: "", activeState: "Active", generatedMailings: 1 };
  const subB = { subscriptionId: "sn2", subscriberId: "sub1", recipientId: "rec1", plan: "6-month", character: "Ringo", startDate: "", endDate: "", activeState: "Active", generatedMailings: 1 };
  const recipient = { recipientId: "rec1", subscriberId: "sub1", name: "Ava Example", address: "1 Main St", characters: ["Marley"], totalMailings: 1, nextShipDate: "2026-08-15" };
  const seed = seedWith({ mailings: [m1, m2], subscriptions: [subA, subB], recipients: [recipient] });

  assert.deepEqual(findSubscriptionMailings("sn1", seed), [m1]);
  assert.equal(getSubscriberSubscriptions("sub1", seed).length, 2);
  assert.equal(getRecipientName("rec1", seed), "Ava Example");
  assert.equal(getRecipient("rec1", seed), recipient);
  assert.equal(getRecipientName("nope", seed), "Unknown recipient");
  assert.equal(getRecipient("nope", seed), null);
});

// includesText/packetRows/packetProblemRows: moved here from
// app/crm/format.ts (includesText) and app/crm/legacy-app.js (the other
// two) in Phase 1 step 7, once Launch Plan needed the same packet
// derivation Batch Packet already had - see this module's own header for
// the full reasoning. New coverage: these three had never been unit
// tested before (only indirectly, through the packet render-snapshot).

test("includesText matches case-insensitively against any of the given values", () => {
  assert.equal(includesText(["Marley", "Ringo"], "marl"), true);
  assert.equal(includesText(["Marley", "Ringo"], "zzz"), false);
});

test("includesText treats a blank/whitespace-only query as matching everything", () => {
  assert.equal(includesText(["Marley", "Ringo"], ""), true);
  assert.equal(includesText(["Marley", "Ringo"], "   "), true);
});

test("packetRows excludes Archived, Mailed, and non-matching-batch-date rows", () => {
  const active = mailing({ mailingId: "m1", activeState: "Active", status: "To Prepare", shipDate: "2026-08-15" });
  const archived = mailing({ mailingId: "m2", activeState: "Archived", status: "To Prepare", shipDate: "2026-08-15" });
  const mailed = mailing({ mailingId: "m3", activeState: "Active", status: "Mailed", shipDate: "2026-08-15" });
  const wrongBatch = mailing({ mailingId: "m4", activeState: "Active", status: "To Prepare", shipDate: "2026-09-01" });
  const rows = [active, archived, mailed, wrongBatch];

  assert.deepEqual(
    packetRows(rows, "2026-08-15", "all", "").map((m) => m.mailingId),
    ["m1"],
  );
});

test("packetRows: batchDate '' (all open batches) does not filter by ship date at all", () => {
  const rows = [
    mailing({ mailingId: "m1", shipDate: "2026-08-15" }),
    mailing({ mailingId: "m2", shipDate: "2026-09-01" }),
  ];
  assert.deepEqual(packetRows(rows, "", "all", "").map((m) => m.mailingId).sort(), ["m1", "m2"]);
});

test("packetRows: packetScope 'monthly' keeps only Month-to-month, any other scope keeps every plan", () => {
  const monthly = mailing({ mailingId: "m1", plan: "Month-to-month" });
  const twelveMonth = mailing({ mailingId: "m2", plan: "12-month" });
  const rows = [monthly, twelveMonth];

  assert.deepEqual(packetRows(rows, "", "monthly", "").map((m) => m.mailingId), ["m1"]);
  assert.deepEqual(packetRows(rows, "", "all", "").map((m) => m.mailingId).sort(), ["m1", "m2"]);
});

test("packetRows: query filters via includesText against recipient/email/character/plan/status/mailingId/orderId", () => {
  const rows = [
    mailing({ mailingId: "m1", recipientName: "Ava Example", email: "ava@example.test", orderId: "ORD-1" }),
    mailing({ mailingId: "m2", recipientName: "Ben Example", email: "ben@example.test", orderId: "ORD-2" }),
  ];
  assert.deepEqual(packetRows(rows, "", "all", "Ava").map((m) => m.mailingId), ["m1"]);
  assert.deepEqual(packetRows(rows, "", "all", "ORD-2").map((m) => m.mailingId), ["m2"]);
});

test("packetRows sorts by envelope stock, then drive character key, then recipient name", () => {
  const rows = [
    mailing({ mailingId: "m1", character: "Ringo", recipientName: "Zed" }),
    mailing({ mailingId: "m2", character: "Harper", recipientName: "Bea" }),
    mailing({ mailingId: "m3", character: "Harper", recipientName: "Ava" }),
  ];
  // Envelope stock: "Harper color envelope" < "Ringo color envelope"
  // alphabetically, so both Harper rows sort before the Ringo row; within
  // Harper, recipient name breaks the tie (Ava before Bea).
  assert.deepEqual(
    packetRows(rows, "", "all", "").map((m) => m.mailingId),
    ["m3", "m2", "m1"],
  );
});

test("packetProblemRows includes a row with a High-severity exception", () => {
  const m = mailing({ mailingId: "m1", plan: "Month-to-month" });
  const seed = seedWith({ mailings: [m], exceptions: [exception({ mailingId: "m1", severity: "High" })] });
  assert.deepEqual(packetProblemRows([m], seed, new Set(), {}).map((r) => r.mailingId), ["m1"]);
});

test("packetProblemRows includes a row whose payment component isn't Active, or whose qa component is Problem", () => {
  const m1 = mailing({ mailingId: "m1", plan: "Month-to-month" });
  const m2 = mailing({ mailingId: "m2", plan: "Month-to-month" });
  const seed = seedWith({ mailings: [m1, m2] });
  const componentOverrides = {
    "m1::2::payment": "CC Failed",
    "m2::2::qa": "Problem",
  };
  assert.deepEqual(
    packetProblemRows([m1, m2], seed, new Set(), componentOverrides).map((r) => r.mailingId).sort(),
    ["m1", "m2"],
  );
});

test("packetProblemRows includes a row with no ship date, and excludes a genuinely clean row", () => {
  const clean = mailing({ mailingId: "m1", plan: "Month-to-month", shipDate: "2026-08-15" });
  const noShipDate = mailing({ mailingId: "m2", plan: "Month-to-month", shipDate: "" });
  const seed = seedWith({ mailings: [clean, noShipDate] });
  assert.deepEqual(packetProblemRows([clean, noShipDate], seed, new Set(), {}).map((r) => r.mailingId), ["m2"]);
});
