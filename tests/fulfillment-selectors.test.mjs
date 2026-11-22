import assert from "node:assert/strict";
import test from "node:test";
import { artifactBatchRows, computeFulfillmentData, customerJobRows, envelopeBatches, envelopeManifestRows, fulfillmentProductionRows, fulfillmentSpreadsheetRows, printerAddressRows, printerDesignGroups, subscriberScheduleRows, subtractCalendarDays } from "../app/crm/views/printer-fulfillment/fulfillment-selectors.ts";
import { fulfillmentEnvelopeBatchHtml } from "../app/crm/views/printer-fulfillment/envelope-batch-html.ts";

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
  const readyMailing = mailing({ character: "Marley", letterNumber: "5" });
  const data = computeFulfillmentData(dataset([readyMailing]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/marley/5");
  assert.equal(data.printerDueDate, "2026-10-25");
  assert.equal(data.readyRows[0].recipientAddress, "887 Lake Road, Milton, VT 05468");
  assert.equal(data.readyRows[0].envelopeType, "Marley color envelope");
  assert.equal(data.readyRows[0].giftMessage, "Love from Grammy");
  assert.equal(data.readyRows[0].renewalCard, "");
  const [sheetRow] = fulfillmentSpreadsheetRows(data.readyRows);
  assert.match(sheetRow["Mail To"], /^Aubrey Nichols\n/);
  assert.equal(sheetRow["Series - USE EXACTLY"], "Marley");
  assert.equal(sheetRow["Letter PDF"], "Marley_Letter_05_PRINT_READY.pdf");
  assert.equal(sheetRow["PUT INSIDE"], "Fold exact letter into Dark pink small inner envelope; leave inner envelope BLANK and UNSEALED; Add item: Leaf charm; Gift message: Love from Grammy");
  assert.match(sheetRow["ENVELOPE / OUTSIDE"], /KIDS USPS stamp/);
  assert.match(sheetRow["ENVELOPE / OUTSIDE"], /wax seal on OUTER envelope/);
  assert.equal(sheetRow.Status, "Ready");
});

test("envelope batches and manifests preserve the PDF page reference", () => {
  const data = computeFulfillmentData(dataset([mailing({ character: "Marley", letterNumber: "5" })]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/marley/5");
  const [batch] = envelopeBatches(data.readyRows);
  assert.equal(batch.fileName, "2026-11-01_Marley_A7_Envelopes_ALL.pdf");
  assert.equal(envelopeManifestRows(data.readyRows)[0].Page, 1);
  const html = fulfillmentEnvelopeBatchHtml(batch);
  assert.match(html, /top: 55%/);
  assert.match(html, /Aubrey Nichols/);
  assert.match(html, /--address-font:'Arial'/);
  const [job] = customerJobRows(data.readyRows);
  assert.equal(job["Cycle ID"], "2026-11-01");
  assert.equal(job["Envelope Batch PDF"], batch.fileName);
  assert.equal(job["Envelope Page"], 1);
  assert.equal(job.Postage, "KIDS USPS stamp");
});

test("shared artifact production is counted once per grouped item", () => {
  const second = mailing({ mailingId: "MAIL-2", character: "Marley", letterNumber: "5" });
  const data = computeFulfillmentData(dataset([mailing({ character: "Marley", letterNumber: "5" }), second]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/marley/5");
  const [batch] = artifactBatchRows(data.readyRows);
  assert.equal(batch["Shared Production Item"], "Add item: Leaf charm");
  assert.equal(batch.Quantity, 2);
});

test("Seraphine Letter 1 requires the charcoal feather sketch", () => {
  const data = computeFulfillmentData(dataset([mailing({ character: "Seraphine", letterNumber: "1" })]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/seraphine/1");
  assert.equal(data.readyRows.length, 0);
  assert.equal(data.heldRows.length, 1);
  assert.match(data.heldRows[0].insideInstructions, /Charcoal feather sketch/);
  assert.ok(data.heldRows[0].stopReasons.includes("Seraphine Letter 1 feather-sketch print file is not attached/confirmed"));
  const [sheetRow] = fulfillmentSpreadsheetRows(data.heldRows);
  assert.match(sheetRow["PUT INSIDE"], /Charcoal feather sketch/);
  assert.equal(sheetRow.Status, "STOP");
});

test("Legends uses the standard printer address font and remains exportable", () => {
  const data = computeFulfillmentData(dataset(), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/legends/11");
  assert.equal(data.readyRows.length, 1);
  assert.equal(data.readyRows[0].productionProfile.fontFamily, "Arial");
});

test("printer exports separate each design and split addresses into required columns", () => {
  const data = computeFulfillmentData(dataset([mailing({ character: "Marley", letterNumber: "5" })]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/marley/5");
  const [group] = printerDesignGroups(data, {}, "Main");
  assert.equal(group.designGroup, "Marley_A7");
  const [row] = printerAddressRows(group);
  assert.deepEqual(row, { "Order ID": "ORDER-1", "Recipient Name": "Aubrey Nichols", "Address Line 1": "887 Lake Road", "Address Line 2": "", City: "Milton", State: "VT", ZIP: "05468", Character: "Marley", Version: "Standard", "Letter Number": "5", "Mail Date": "2026-11-01" });
});

test("North Pole is an exportable separate A9 design and keeps the woodland choice as its version", () => {
  const northPole = mailing({ character: "North Pole", plan: "One-time", letterNumber: "1", notes: "NORTH POLE CHILD FIRST NAME: Joe; PREFERRED WOODLAND CHARACTER: Ringo; NORTH POLE PERSONALIZATION: Helped when I was in the hospital" });
  const data = computeFulfillmentData(dataset([northPole]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/north-pole/1");
  assert.equal(data.readyRows.length, 1);
  const [group] = printerDesignGroups(data, {}, "Main");
  assert.equal(group.designGroup, "North_Pole_A9");
  const [row] = printerAddressRows(group);
  assert.equal(row.Character, "North Pole");
  assert.equal(row.Version, "Ringo");
  assert.equal(row["Recipient Name"], "Aubrey Nichols");
  assert.match(data.readyRows[0].insideInstructions, /Personalized North Pole letter/);
  assert.match(data.readyRows[0].specialHandling, /NORTH POLE PERSONALIZATION/);
});

test("payment, eligibility, owner, exclusion, and late-addendum controls gate exports", () => {
  const data = computeFulfillmentData(dataset([mailing({ character: "Marley", letterNumber: "5" })]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "https://drive.test/marley/5");
  const key = "MAIL-1::2";
  const base = { owner: "Printer", excludeFromPrinter: false, paymentCleared: true, mailingEligible: true, lateAddendumStatus: "Late addendum", fulfillmentStatus: "Pending", qcInitials: "AB", exportedDate: "", batchName: "" };
  assert.equal(printerDesignGroups(data, { [key]: base }, "Main").length, 0);
  assert.equal(printerDesignGroups(data, { [key]: base }, "Late addendum").length, 1);
  assert.equal(printerDesignGroups(data, { [key]: { ...base, excludeFromPrinter: true } }, "Late addendum").length, 0);
  const [production] = fulfillmentProductionRows(data, { [key]: base }, "2026-11-01_Main");
  assert.equal(production["QC Initials"], "AB");
  assert.equal(production["Glue Sticker"], "Required on outer envelope");
});

test("high-risk rows are held and excluded from the printer spreadsheet", () => {
  const highIssue = { exceptionId: "EX-1", severity: "High", reason: "Missing address", mailingId: "MAIL-1", subscriberId: "SUB-1", recipientName: "Aubrey Nichols", shipDate: "2026-11-01", suggestedShipDate: "2026-11-01", status: "To Prepare", sourceRow: 2 };
  const data = computeFulfillmentData(dataset([mailing()], [highIssue]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "");
  assert.equal(data.readyRows.length, 0);
  assert.equal(data.heldRows.length, 1);
  assert.ok(data.heldRows[0].stopReasons.includes("Missing address"));
});

test("missing printer files and unverified assembly rules become visible STOP rows", () => {
  const data = computeFulfillmentData(dataset([mailing({ character: "Oliver", letterNumber: "2", notes: "NEW OLIVER - use the new package" })]), {}, new Set(), {}, "2026-11-01", "", "2026-10-17", () => "");
  assert.equal(data.readyRows.length, 0);
  assert.equal(data.heldRows.length, 1);
  assert.equal(data.heldRows[0].seriesName, "Oliver - New");
  assert.ok(data.heldRows[0].stopReasons.includes("Letter file is not attached/confirmed"));
  const [sheetRow] = fulfillmentSpreadsheetRows(data.heldRows);
  assert.equal(sheetRow.Status, "STOP");
  assert.equal(sheetRow["Letter PDF"], "");
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
