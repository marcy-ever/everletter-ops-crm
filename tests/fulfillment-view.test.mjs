import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PrinterFulfillment from "../app/crm/views/printer-fulfillment/PrinterFulfillment.tsx";
import { computeFulfillmentData, printerDesignGroups } from "../app/crm/views/printer-fulfillment/fulfillment-selectors.ts";

function data() {
  const mailing = { mailingId: "MAIL-1", subscriberId: "SUB-1", recipientId: "REC-1", orderId: "ORDER-1", orderDate: "2026-11-01", subscriptionId: "PLAN-1", recipientName: "Sample Recipient", email: "buyer@example.test", character: "Marley", plan: "6-month", letterNumber: "5", shipDate: "2026-11-15", suggestedShipDate: "2026-11-15", status: "To Prepare", activeState: "Active", notes: "", overdue: false, dueNext14Days: false, sourceRow: 2 };
  const seed = { summary: {}, subscribers: [], recipients: [{ recipientId: "REC-1", subscriberId: "SUB-1", name: "Sample Recipient", address: "1 Main St, Denver, CO 80000", characters: ["Marley"], totalMailings: 1, nextShipDate: "2026-11-15" }], orders: [], subscriptions: [{ subscriptionId: "PLAN-1", subscriberId: "SUB-1", recipientId: "REC-1", plan: "6-month", character: "Marley", startDate: "2026-11-01", endDate: "2027-05-01", activeState: "Active", generatedMailings: 1 }], mailings: [mailing], exceptions: [], automationRules: [] };
  return computeFulfillmentData(seed, {}, new Set(), {}, "2026-11-15", "", "2026-11-01", () => "https://drive.test/marley/5");
}

test("Mailing Fulfillment shows design exports and every operational control", () => {
  const fulfillment = data();
  const html = renderToStaticMarkup(React.createElement(PrinterFulfillment, { data: fulfillment, controls: {}, history: [], loading: false, message: "", mainGroups: printerDesignGroups(fulfillment, {}, "Main"), lateGroups: [], onControlChange() {}, onExportGroup() {}, onDownloadProductionList() {}, onDownloadSubscriberSchedule() {}, onOpenEnvelopeBatch() {} }));
  assert.match(html, /Main printer batch/);
  assert.match(html, /Ashley \/ Prepacked/);
  assert.match(html, /Ready to mail/);
  assert.match(html, /Marley_A7 \(1\)/);
  assert.match(html, /Payment/);
  assert.match(html, /Eligible/);
  assert.match(html, /Exclude/);
  assert.match(html, /Late addendum/);
  assert.match(html, /QC/);
  assert.match(html, /Download Combined Production List/);
});
