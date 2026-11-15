import assert from "node:assert/strict";
import test from "node:test";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";

const skip = e2eSkipReason({ requiresFixture: false });

test("fulfillment controls persist and exports retain an archived snapshot", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { writeImport } = await import("../lib/write-to-tables.ts");
  const { fulfillmentExports } = await import("../db/schema/index.ts");
  const { GET, POST } = await import("../app/api/fulfillment/route.ts");
  const db = getDb();
  await truncateAllTables(db);
  const seed = buildSeedFromSpreadsheet([{
    "Order ID": "PRINT-1", "Original Order Date": "2026-10-20",
    "Customer Name and Address": "Print Customer\n1 Press Way\nDenver, CO 80000",
    Character: "Marley", "Letter Number": "5", "Ship Date": "2026-11-15",
    Subscription: "6-month", Status: "To Prepare", "Active?": "Yes", Email: "print@example.test",
  }], "fulfillment-test.xlsx", new Date("2026-11-01T12:00:00Z"), []);
  await db.transaction((tx) => writeImport(seed, tx));
  const mailing = seed.mailings[0];
  const control = { owner: "Printer", excludeFromPrinter: false, paymentCleared: true, mailingEligible: true, lateAddendumStatus: "Late addendum", fulfillmentStatus: "Pending", qcInitials: "MP", exportedDate: "", batchName: "" };
  const controlResponse = await POST(new Request("http://localhost/api/fulfillment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "control", mailingId: mailing.mailingId, sourceRow: String(mailing.sourceRow), control }) }));
  assert.equal(controlResponse.status, 200);
  const exportResponse = await POST(new Request("http://localhost/api/fulfillment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "recordExport", batchDate: "2026-11-15", batchName: "2026-11-15_Late_1", exportKind: "Late addendum", designGroup: "Marley_A7", snapshot: [{ mailingId: mailing.mailingId, sourceRow: mailing.sourceRow, recipient: mailing.recipientName }] }) }));
  assert.equal(exportResponse.status, 200);
  const response = await GET(new Request("http://localhost/api/fulfillment?batchDate=2026-11-15"));
  const body = await response.json();
  assert.equal(body.controls[0].qcInitials, "MP");
  assert.equal(body.controls[0].fulfillmentStatus, "Exported");
  assert.equal(body.controls[0].batchName, "2026-11-15_Late_1");
  assert.equal(body.history[0].designGroup, "Marley_A7");
  assert.equal((await db.select().from(fulfillmentExports))[0].snapshot[0].recipient, "Print Customer");
});
