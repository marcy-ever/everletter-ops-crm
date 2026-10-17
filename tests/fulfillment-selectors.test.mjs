import assert from "node:assert/strict";
import test from "node:test";
import { computeFulfillmentData, fulfillmentSpreadsheetRows, subscriberScheduleRows, subtractCalendarDays } from "../app/crm/views/printer-fulfillment/fulfillment-selectors.ts";

function mailing(overrides = {}) {
  return { mailingId: "MAIL-1", subscriberId: "SUB-1", recipientId: "REC-1", orderId: "ORDER-1", orderDate: "2026-10-01", subscriptionId: "PLAN-1", recipientName: "Aubrey Nichols", email: "buyer@example.test", character: "Legends", plan: "6-month", letterNumber: "11", shipDate: "2026-11-01", suggestedShipDate: "2026-11-01", status: "To Prepare", activeState: "Active", notes: "GIFT MESSAGE — handwrite in Letter 1: Love from Grammy", overdue: false, dueNext14Days: false, sourceRow: 2, ...overrides };
}

function dataset(mailings = [mailing()], exceptions = []) {
  return {
    summary: {}, subscribers: [],
    recipients: [{ recipientId: "REC-1", subscriberId: "SUB-1", name: "Aubrey Nichols", address: "887 Lake Road, Milton, VT 05468", characters: ["Legends"], totalMailings: 12, nextShipDate: "2026-11-01" }],
    orders: [],
    subscriptions: [{ subscriptionId: "PLAN-1", subscriberId: "SUB-1", recipientId: "REC-1", plan: "6-month", character: "Legends", startDate: "2026-05-01", endDate: "2026-11-15", activeState: "Active", generatedMailings: 12 }],
    mailings, exceptions, automationRules: [],
  };
}

test("printer deadline is seven calendar days before mailing", () => {
  assert.equal(subtractCalendarDays("2026-11-01", 7), "2026-10-25");
  assert.equal(subtractCalendarDays("2027-01-01", 7), "2026-12-25");
});

test("fulfillment data includes the operational details the printer needs", () => {
  const data = computeFulfillmentData(dataset(), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/legends/11");
  assert.equal(data.printerDueDate, "2026-10-25");
  assert.equal(data.readyRows[0].recipientAddress, "887 Lake Road, Milton, VT 05468");
  assert.equal(data.readyRows[0].envelopeType, "Legends color envelope");
  assert.equal(data.readyRows[0].giftMessage, "Love from Grammy");
  assert.equal(data.readyRows[0].renewalCard, "Include renewal card");
  const [sheetRow] = fulfillmentSpreadsheetRows(data.readyRows);
  assert.equal(sheetRow["Recipient Name"], "Aubrey Nichols");
  assert.equal(sheetRow["Letter Folder"], "https://drive.test/legends/11");
});

test("high-risk rows are held and excluded from the printer spreadsheet", () => {
  const highIssue = { exceptionId: "EX-1", severity: "High", reason: "Missing address", mailingId: "MAIL-1", subscriberId: "SUB-1", recipientName: "Aubrey Nichols", shipDate: "2026-11-01", suggestedShipDate: "2026-11-01", status: "To Prepare", sourceRow: 2 };
  const data = computeFulfillmentData(dataset([mailing()], [highIssue]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "");
  assert.equal(data.readyRows.length, 0);
  assert.equal(data.heldRows.length, 1);
});

test("mailed and inactive rows never enter a printer batch", () => {
  const data = computeFulfillmentData(dataset([mailing({ mailingId: "MAIL-MAILED", status: "Mailed" }), mailing({ mailingId: "MAIL-INACTIVE", activeState: "Archived" })]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "");
  assert.equal(data.readyRows.length, 0);
  assert.equal(data.heldRows.length, 0);
});

test("master subscriber schedule replaces the manual L1-L24 tracking grid", () => {
  const seed = dataset([
    mailing({ letterNumber: "1", status: "Mailed", shipDate: "2026-05-01" }),
    mailing({ mailingId: "MAIL-2", letterNumber: "2", status: "To Prepare", shipDate: "2026-05-15" }),
  ]);
  seed.subscribers = [{ subscriberId: "SUB-1", displayName: "Customer Name", email: "buyer@example.test", status: "Active", firstOrderDate: "2026-05-01", openMailings: 1, totalMailings: 2, nextShipDate: "2026-05-15", issueCount: 0 }];
  const [row] = subscriberScheduleRows(seed, {});
  assert.equal(row["Customer Name"], "Customer Name");
  assert.equal(row["Recipient Name"], "Aubrey Nichols");
  assert.equal(row.Character, "Legends");
  assert.equal(row.L1, "Mailed");
  assert.equal(row.L2, "2026-05-15");
  assert.equal(row.L24, "");
});
