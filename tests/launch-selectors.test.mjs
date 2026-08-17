import assert from "node:assert/strict";
import test from "node:test";
import { computeLaunchPlanData, LAUNCH_ROADMAP } from "../app/crm/views/launch-plan/launch-selectors.ts";

// New coverage from Phase 1 step 7 (CLAUDE.md) - renderLaunch()'s six
// checklist items had never been unit tested before, only indirectly
// through the launch render-snapshot. Locks the real conditions each
// status flips on (rows.length, monthlyEnvelopeCount, problemRows.length),
// and proves the view is deterministic given an explicit `today` - no
// globalThis.Date patching anywhere in this file.

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

function seedWith({ mailings = [], exceptions = [] } = {}) {
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
    recipients: [],
    orders: [],
    subscriptions: [],
    mailings,
    exceptions,
    automationRules: [],
  };
}

const TODAY = "2026-08-12";

function checklistItem(data, label) {
  const item = data.checklist.find((entry) => entry.label === label);
  assert.ok(item, `no checklist item labeled "${label}"`);
  return item;
}

test("computeLaunchPlanData is deterministic given an explicit today - no clock reached for internally", () => {
  const seed = seedWith({ mailings: [mailing()] });
  const a = computeLaunchPlanData(seed, [mailing()], new Set(), {}, "next", "all", "", TODAY);
  const b = computeLaunchPlanData(seed, [mailing()], new Set(), {}, "next", "all", "", TODAY);
  assert.deepEqual(a, b);
  assert.equal(a.today, TODAY);
});

test("\"Run the Batch Packet\" flips Ready/Check on rows.length", () => {
  const withRows = computeLaunchPlanData(seedWith({ mailings: [mailing()] }), [mailing()], new Set(), {}, "next", "all", "", TODAY);
  assert.equal(checklistItem(withRows, "Run the Batch Packet before assembly").status, "Ready");

  const noRows = computeLaunchPlanData(seedWith({ mailings: [] }), [], new Set(), {}, "next", "all", "", TODAY);
  assert.equal(checklistItem(noRows, "Run the Batch Packet before assembly").status, "Check");
});

test("\"Print month-to-month envelopes\" flips Ready/Clear on monthlyEnvelopeCount", () => {
  const monthly = mailing({ mailingId: "m1", plan: "Month-to-month" });
  const withMonthly = computeLaunchPlanData(seedWith({ mailings: [monthly] }), [monthly], new Set(), {}, "next", "all", "", TODAY);
  assert.equal(checklistItem(withMonthly, "Print month-to-month envelopes in pairs").status, "Ready");

  const twelveMonth = mailing({ mailingId: "m1", plan: "12-month" });
  const noMonthly = computeLaunchPlanData(seedWith({ mailings: [twelveMonth] }), [twelveMonth], new Set(), {}, "next", "all", "", TODAY);
  assert.equal(checklistItem(noMonthly, "Print month-to-month envelopes in pairs").status, "Clear");
});

test("\"Clear held/problem rows\" flips Needs Review/Ready on problemRows.length, with matching detail text", () => {
  const problem = mailing({ mailingId: "m1", shipDate: "" }); // no ship date -> a problem row
  const withProblem = computeLaunchPlanData(seedWith({ mailings: [problem] }), [problem], new Set(), {}, "next", "all", "", TODAY);
  const problemItem = checklistItem(withProblem, "Clear held/problem rows before printing");
  assert.equal(problemItem.status, "Needs Review");
  assert.match(problemItem.detail, /1 rows are held in this packet/);

  const clean = mailing({ mailingId: "m1", shipDate: "2026-08-15" });
  const noProblem = computeLaunchPlanData(seedWith({ mailings: [clean] }), [clean], new Set(), {}, "next", "all", "", TODAY);
  const cleanItem = checklistItem(noProblem, "Clear held/problem rows before printing");
  assert.equal(cleanItem.status, "Ready");
  assert.equal(cleanItem.detail, "No held rows in the active packet.");
});

test("highExceptionCount counts only unreviewed High-severity exceptions", () => {
  const m = mailing({ mailingId: "m1" });
  const high = exception({ exceptionId: "e1", mailingId: "m1", severity: "High" });
  const low = exception({ exceptionId: "e2", mailingId: "m1", severity: "Low" });
  const seed = seedWith({ mailings: [m], exceptions: [high, low] });

  const unreviewed = computeLaunchPlanData(seed, [m], new Set(), {}, "next", "all", "", TODAY);
  assert.equal(unreviewed.highExceptionCount, 1);

  const reviewed = computeLaunchPlanData(seed, [m], new Set(["e1"]), {}, "next", "all", "", TODAY);
  assert.equal(reviewed.highExceptionCount, 0);
});

test("the two static checklist items (Next/Later) are always present, regardless of data", () => {
  const data = computeLaunchPlanData(seedWith({ mailings: [] }), [], new Set(), {}, "next", "all", "", TODAY);
  assert.equal(checklistItem(data, "Give Ashley a shared version before Squarespace sync").status, "Next");
  assert.equal(checklistItem(data, "Treat Mailchimp sample automation as phase two").status, "Later");
  assert.equal(data.checklist.length, 6);
});

test("the roadmap is the static LAUNCH_ROADMAP content, unchanged by input data", () => {
  const data = computeLaunchPlanData(seedWith({ mailings: [] }), [], new Set(), {}, "next", "all", "", TODAY);
  assert.equal(data.roadmap, LAUNCH_ROADMAP);
  assert.equal(data.roadmap.length, 6);
});

test("packetScope/query/batchFilter still shape the checklist, preserving the legacy coupling exactly (see this module's own header)", () => {
  const monthly = mailing({ mailingId: "m1", plan: "Month-to-month" });
  const twelveMonth = mailing({ mailingId: "m2", plan: "12-month" });
  const seed = seedWith({ mailings: [monthly, twelveMonth] });
  const mailings = [monthly, twelveMonth];

  const scopedToMonthly = computeLaunchPlanData(seed, mailings, new Set(), {}, "next", "monthly", "", TODAY);
  assert.equal(checklistItem(scopedToMonthly, "Run the Batch Packet before assembly").detail.startsWith("1 mailing rows"), true);

  const allScopes = computeLaunchPlanData(seed, mailings, new Set(), {}, "next", "all", "", TODAY);
  assert.equal(checklistItem(allScopes, "Run the Batch Packet before assembly").detail.startsWith("2 mailing rows"), true);
});
