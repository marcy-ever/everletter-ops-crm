// Coverage for app/crm/views/queue/queue-selectors.ts - Phase 1 step 13
// (CLAUDE.md), the busiest operational screen in the app. Exercises the
// full filter chain computeQueueRows() reproduces from renderQueue():
// active-only, high-exception exclusion, batch date, status filter,
// search, and the 120-row cap.
import assert from "node:assert/strict";
import test from "node:test";
import { computeQueueRows } from "../app/crm/views/queue/queue-selectors.ts";

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
    dueNext14Days: false,
    sourceRow: 2,
    ...overrides,
  };
}

function exception(overrides = {}) {
  return {
    exceptionId: "EXC-1",
    severity: "High",
    reason: "Missing email",
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    recipientName: "Ava",
    shipDate: "2026-08-15",
    suggestedShipDate: "",
    status: "To Prepare",
    sourceRow: 2,
    ...overrides,
  };
}

function seedWith({ mailings = [], exceptions = [] } = {}) {
  return { subscribers: [], recipients: [], subscriptions: [], orders: [], mailings, exceptions, automationRules: [], summary: {} };
}

const TODAY = "2026-08-12";

test("computeQueueRows excludes archived (non-Active) mailings", () => {
  const seed = seedWith({ mailings: [mailing({ mailingId: "MAIL-ACTIVE", activeState: "Active" }), mailing({ mailingId: "MAIL-ARCHIVED", activeState: "Archived" })] });
  const { rows } = computeQueueRows(seed, {}, new Set(), "all", "All", "", TODAY);
  assert.deepEqual(
    rows.map((row) => row.mailingId),
    ["MAIL-ACTIVE"],
  );
});

test("computeQueueRows excludes mailings with an active High-severity exception, but not Low ones", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-HIGH" }), mailing({ mailingId: "MAIL-LOW" })],
    exceptions: [exception({ mailingId: "MAIL-HIGH", severity: "High" }), exception({ mailingId: "MAIL-LOW", severity: "Low" })],
  });
  const { rows } = computeQueueRows(seed, {}, new Set(), "all", "All", "", TODAY);
  assert.deepEqual(
    rows.map((row) => row.mailingId),
    ["MAIL-LOW"],
  );
});

test("computeQueueRows includes a mailing whose High exception is already reviewed", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-1" })],
    exceptions: [exception({ mailingId: "MAIL-1", severity: "High" })],
  });
  const reviewed = new Set(["MAIL-1::SUB-1::Missing email::2026-08-15"]);
  const { rows } = computeQueueRows(seed, {}, reviewed, "all", "All", "", TODAY);
  assert.equal(rows.length, 1);
});

test("computeQueueRows' statusFilter 'Open' includes every open status, excludes Mailed", () => {
  const seed = seedWith({
    mailings: [
      mailing({ mailingId: "MAIL-PREP", status: "To Prepare" }),
      mailing({ mailingId: "MAIL-PRINT", status: "Printing" }),
      mailing({ mailingId: "MAIL-MAILED", status: "Mailed" }),
    ],
  });
  const { rows } = computeQueueRows(seed, {}, new Set(), "all", "Open", "", TODAY);
  assert.deepEqual(
    rows.map((row) => row.mailingId).sort(),
    ["MAIL-PREP", "MAIL-PRINT"],
  );
});

test("computeQueueRows' statusFilter 'All' includes every status, and a specific status filters to exactly that one", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-PREP", status: "To Prepare" }), mailing({ mailingId: "MAIL-MAILED", status: "Mailed" })],
  });
  assert.equal(computeQueueRows(seed, {}, new Set(), "all", "All", "", TODAY).rows.length, 2);
  const { rows } = computeQueueRows(seed, {}, new Set(), "all", "Mailed", "", TODAY);
  assert.deepEqual(
    rows.map((row) => row.mailingId),
    ["MAIL-MAILED"],
  );
});

test("computeQueueRows supports selecting several statuses at once", () => {
  const seed = seedWith({ mailings: [
    mailing({ mailingId: "MAIL-PREP", status: "To Prepare" }),
    mailing({ mailingId: "MAIL-ASSEMBLING", status: "Assembling" }),
    mailing({ mailingId: "MAIL-READY", status: "Ready to Mail" }),
    mailing({ mailingId: "MAIL-MAILED", status: "Mailed" }),
  ] });
  const rows = computeQueueRows(seed, {}, new Set(), "all", "To Prepare|Assembling|Ready to Mail", "", TODAY).rows;
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => ["To Prepare", "Assembling", "Ready to Mail"].includes(row.status)));
  assert.ok(rows.every((row) => row.status !== "Mailed"));
});

test("computeQueueRows' statusFilter reflects statusOverrides, not just the mailing's original status", () => {
  const seed = seedWith({ mailings: [mailing({ mailingId: "MAIL-1", status: "To Prepare" })] });
  const { rows } = computeQueueRows(seed, { "MAIL-1::2": "Mailed" }, new Set(), "all", "Mailed", "", TODAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Mailed");
  assert.equal(rows[0].originalStatus, "To Prepare");
});

test("computeQueueRows searches recipientName/email/character/plan/status/mailingId/orderId", () => {
  const item = mailing();
  const seed = seedWith({ mailings: [item] });
  for (const query of ["Ava Example", "ava@example.test", "Marley", "Month-to-month", "To Prepare", "MAIL-1", "ORD-1"]) {
    assert.equal(computeQueueRows(seed, {}, new Set(), "all", "All", query, TODAY).rows.length, 1, `query "${query}" should match`);
  }
  assert.equal(computeQueueRows(seed, {}, new Set(), "all", "All", "zzz-no-match-zzz", TODAY).rows.length, 0);
});

test("computeQueueRows caps at 120 rows", () => {
  const mailings = Array.from({ length: 130 }, (_, i) => mailing({ mailingId: `MAIL-${i}`, orderId: `ORD-${i}` }));
  const seed = seedWith({ mailings });
  assert.equal(computeQueueRows(seed, {}, new Set(), "all", "All", "", TODAY).rows.length, 120);
});

test("computeQueueRows' batchDate filters to mailings shipping on that exact date, and is empty when batchFilter is 'all'", () => {
  const seed = seedWith({
    mailings: [mailing({ mailingId: "MAIL-1ST", shipDate: "2026-08-15" }), mailing({ mailingId: "MAIL-15TH", shipDate: "2026-08-01" })],
  });
  const filtered = computeQueueRows(seed, {}, new Set(), "2026-08-15", "All", "", TODAY);
  assert.equal(filtered.batchDate, "2026-08-15");
  assert.deepEqual(
    filtered.rows.map((row) => row.mailingId),
    ["MAIL-1ST"],
  );

  const unfiltered = computeQueueRows(seed, {}, new Set(), "all", "All", "", TODAY);
  assert.equal(unfiltered.batchDate, "");
  assert.equal(unfiltered.rows.length, 2);
});

test("computeQueueRows is deterministic given the same today - same inputs, same output, called twice", () => {
  const seed = seedWith({ mailings: [mailing(), mailing({ mailingId: "MAIL-2", orderId: "ORD-2" })] });
  const a = computeQueueRows(seed, {}, new Set(), "next", "Open", "", TODAY);
  const b = computeQueueRows(seed, {}, new Set(), "next", "Open", "", TODAY);
  assert.deepEqual(a, b);
});
