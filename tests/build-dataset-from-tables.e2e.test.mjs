// End-to-end parity test for lib/build-dataset-from-tables.ts (Step 1 of
// Option B's real cutover - see docs/schema-design.md's "Implementation
// Path" section). Requires a real local Postgres reachable via
// DATABASE_URL (see .env.local / devops/docker-compose.yml) and the real
// test spreadsheet at testing/Import_20260812_181828.xlsx (gitignored,
// developer-local - this test is skipped if either is missing, not
// failed, so it doesn't break `pnpm test` in an environment without them).
//
// Flow: parse the real spreadsheet through the REAL public/app.js
// (sandboxed vm, same technique as tests/ids.test.mjs) to get the
// client-computed seed -> write it through the REAL lib/dual-write.ts
// dualWriteImport() into the real normalized tables -> call the REAL
// buildDatasetFromTables() to reconstruct a seed from those tables ->
// deep-compare every field of every record in both, reporting every
// discrepancy, not just the first.
//
// Both the client-side and reconstruction "now" are pinned to the exact
// same instant (see fixedNow below), so summary.asOf/overdue/dueNext14Days
// aren't polluted by the intentional frozen-vs-live difference (see
// lib/mailing-rules.ts's module comment) - any remaining discrepancy in
// those fields is a real bug, not a day-boundary artifact.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { sql } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XLSX_PATH = path.join(ROOT, "testing/Import_20260812_181828.xlsx");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const hasFixture = fs.existsSync(XLSX_PATH);
const hasDbUrl = !!process.env.DATABASE_URL;

function loadAppJsSandbox(fixedNow) {
  const source = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");

  function stubElement() {
    return {
      addEventListener() {},
      querySelector: () => stubElement(),
      querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {},
      dataset: {},
      getAttribute: () => null,
      setAttribute() {},
      set innerHTML(_value) {},
      get innerHTML() {
        return "";
      },
    };
  }

  const RealDate = Date;
  const sandbox = {
    document: { querySelector: () => stubElement(), querySelectorAll: () => [] },
    window: { EVERLETTER_SEED: undefined, location: { hash: "" } },
    console,
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    TextEncoder,
  };
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixedNow.getTime());
      else super(...args);
    }
    static now() {
      return fixedNow.getTime();
    }
  }
  sandbox.Date = FixedDate;
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "public/app.js" }).runInContext(sandbox);
  return sandbox;
}

// Deep, key-based comparison rather than blind positional comparison: some
// entities legitimately have fewer records in the reconstruction than in
// app.js's original seed (rows lib/dual-write.ts skips - unrecognized
// plan, missing ship date, ambiguous stable id - see its module docstring
// and lib/build-dataset-from-tables.ts's gap list). Positional comparison
// would misreport every record after the first gap as "different" instead
// of correctly identifying the one row that's actually missing. Records
// present in both sides are compared field by field; a separate order
// check confirms the two arrays agree on ordering for the subset of
// records both sides have.
function compareEntityArrays(label, keyFn, expected, actual, discrepancies) {
  const expectedByKey = new Map(expected.map((r) => [keyFn(r), r]));
  const actualByKey = new Map(actual.map((r) => [keyFn(r), r]));

  for (const [key, record] of expectedByKey) {
    if (!actualByKey.has(key)) {
      discrepancies.push({ entity: label, key, type: "MISSING_IN_RECONSTRUCTION", expected: record });
    }
  }
  for (const [key, record] of actualByKey) {
    if (!expectedByKey.has(key)) {
      discrepancies.push({ entity: label, key, type: "EXTRA_IN_RECONSTRUCTION", actual: record });
    }
  }
  for (const [key, expectedRecord] of expectedByKey) {
    const actualRecord = actualByKey.get(key);
    if (!actualRecord) continue;
    for (const field of Object.keys(expectedRecord)) {
      const expectedValue = expectedRecord[field];
      const actualValue = actualRecord[field];
      const same = Array.isArray(expectedValue) ? JSON.stringify(expectedValue) === JSON.stringify(actualValue) : expectedValue === actualValue;
      if (!same) {
        discrepancies.push({ entity: label, key, type: "FIELD_MISMATCH", field, expected: expectedValue, actual: actualValue });
      }
    }
  }

  const commonExpectedOrder = expected.map(keyFn).filter((k) => actualByKey.has(k));
  const commonActualOrder = actual.map(keyFn).filter((k) => expectedByKey.has(k));
  if (JSON.stringify(commonExpectedOrder) !== JSON.stringify(commonActualOrder)) {
    discrepancies.push({ entity: label, type: "ORDER_MISMATCH", expectedOrder: commonExpectedOrder, actualOrder: commonActualOrder });
  }
}

function compareSummary(expected, actual, discrepancies) {
  for (const field of Object.keys(expected)) {
    if (expected[field] !== actual[field]) {
      discrepancies.push({ entity: "summary", type: "FIELD_MISMATCH", field, expected: expected[field], actual: actual[field] });
    }
  }
}

// Every entry here was individually root-caused against the real test
// spreadsheet (see lib/build-dataset-from-tables.ts's module comment for
// the full explanation of each) - none are guesses. Two real causes
// produce nearly all of them:
//  (a) 2 subscriptions have a blank/unrecognized Plan cell ("Needs
//      Review"), which lib/dual-write.ts deliberately skips writing (it's
//      already flagged by app.js's own exceptions) - cascades to 18
//      ORD-MISSING-* orders, 18 mailings, and (newly found) 2 recipients
//      whose only subscription was one of these two.
//  (b) order ORD-2858 has letter number 4 entered on three separate rows
//      - a genuine spreadsheet duplicate, not a bug - lib/dual-write.ts
//      correctly refuses to guess which one is real and skips all three.
// notes, endDate, and mailings.activeState were closed (see
// db/schema/mailings.ts's active/notes columns and
// db/schema/subscriptions.ts's ended_at column) - no longer allowed here.
// Everything remaining (subscribers' status/firstOrderDate, tie-break
// ordering) is a documented, individually verified schema gap - see
// lib/build-dataset-from-tables.ts. Any discrepancy NOT matching one of
// these rules fails this test - that's the actual regression guard this
// file provides.
const ALLOWED_DISCREPANCIES = [
  (d) => d.entity === "summary" && d.type === "FIELD_MISMATCH" && ["activeSubscriberCount", "archivedSubscriberCount", "recipientCount", "orderCount", "subscriptionCount", "mailingCount", "openMailingCount", "archivedMailingCount", "dueNext14Count"].includes(d.field),
  (d) => d.entity === "subscribers" && d.type === "FIELD_MISMATCH" && ["openMailings", "totalMailings", "nextShipDate", "status", "firstOrderDate"].includes(d.field),
  (d) => d.entity === "subscribers" && d.type === "ORDER_MISMATCH",
  (d) => d.entity === "recipients" && d.type === "MISSING_IN_RECONSTRUCTION",
  (d) => d.entity === "recipients" && d.type === "FIELD_MISMATCH" && ["nextShipDate", "totalMailings"].includes(d.field),
  (d) => d.entity === "recipients" && d.type === "ORDER_MISMATCH",
  (d) => d.entity === "orders" && d.type === "MISSING_IN_RECONSTRUCTION" && d.key.startsWith("ORD-MISSING-"),
  (d) => d.entity === "subscriptions" && d.type === "MISSING_IN_RECONSTRUCTION",
  (d) => d.entity === "subscriptions" && d.type === "FIELD_MISMATCH" && ["generatedMailings"].includes(d.field),
  (d) => d.entity === "mailings" && d.type === "MISSING_IN_RECONSTRUCTION",
  (d) => d.entity === "mailings" && d.type === "ORDER_MISMATCH",
  // exceptions: no allowance - a discrepancy here is always unexpected.
];

function isAllowedDiscrepancy(d) {
  return ALLOWED_DISCREPANCIES.some((rule) => rule(d));
}

test("buildDatasetFromTables reconstructs the real spreadsheet identically to app.js's client-side seed", { skip: !hasFixture || !hasDbUrl }, async (t) => {
  const { dualWriteImport } = await import("../lib/dual-write");
  const { buildDatasetFromTables } = await import("../lib/build-dataset-from-tables");
  const { getDb } = await import("../db");
  const { subscribers } = await import("../db/schema/subscribers");
  const { subscriptions } = await import("../db/schema/subscriptions");
  const { orders } = await import("../db/schema/orders");
  const { mailings } = await import("../db/schema/mailings");
  const { mailingComponents } = await import("../db/schema/mailing_components");
  const { exceptions } = await import("../db/schema/exceptions");

  const db = getDb();
  const fixedNow = new Date("2026-08-12T15:00:00.000Z");
  const sourceFile = "Import_20260812_181828.xlsx";

  await t.test("build the client seed from the real spreadsheet via the real sandboxed app.js", async () => {
    // no-op wrapper, just for readable test output ordering
  });

  const workbook = XLSX.read(fs.readFileSync(XLSX_PATH), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes("mailing")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });

  const appJs = loadAppJsSandbox(fixedNow);
  const clientSeed = appJs.buildSeedFromSpreadsheet(rows, sourceFile);

  await db.execute(sql`TRUNCATE TABLE ${mailingComponents}, ${exceptions}, ${mailings}, ${orders}, ${subscriptions}, ${subscribers} RESTART IDENTITY CASCADE`);
  await dualWriteImport(clientSeed);

  const reconstructed = await buildDatasetFromTables(fixedNow, sourceFile);

  const discrepancies = [];
  compareSummary(clientSeed.summary, reconstructed.summary, discrepancies);
  compareEntityArrays("subscribers", (r) => r.subscriberId, clientSeed.subscribers, reconstructed.subscribers, discrepancies);
  compareEntityArrays("recipients", (r) => r.recipientId, clientSeed.recipients, reconstructed.recipients, discrepancies);
  compareEntityArrays("orders", (r) => r.orderId, clientSeed.orders, reconstructed.orders, discrepancies);
  compareEntityArrays("subscriptions", (r) => r.subscriptionId, clientSeed.subscriptions, reconstructed.subscriptions, discrepancies);
  compareEntityArrays("mailings", (r) => `${r.mailingId}::${r.sourceRow}`, clientSeed.mailings, reconstructed.mailings, discrepancies);
  compareEntityArrays("exceptions", (r) => r.exceptionId, clientSeed.exceptions, reconstructed.exceptions, discrepancies);

  console.log(`\n=== parity check: ${discrepancies.length} total discrepancies ===`);
  console.log(`client seed: ${clientSeed.subscribers.length} subscribers, ${clientSeed.recipients.length} recipients, ${clientSeed.orders.length} orders, ${clientSeed.subscriptions.length} subscriptions, ${clientSeed.mailings.length} mailings, ${clientSeed.exceptions.length} exceptions`);
  console.log(`reconstructed: ${reconstructed.subscribers.length} subscribers, ${reconstructed.recipients.length} recipients, ${reconstructed.orders.length} orders, ${reconstructed.subscriptions.length} subscriptions, ${reconstructed.mailings.length} mailings, ${reconstructed.exceptions.length} exceptions`);

  const byEntity = new Map();
  for (const d of discrepancies) {
    if (!byEntity.has(d.entity)) byEntity.set(d.entity, []);
    byEntity.get(d.entity).push(d);
  }
  for (const [entity, items] of byEntity) {
    console.log(`\n--- ${entity}: ${items.length} discrepancies ---`);
    const byType = new Map();
    for (const item of items) {
      if (!byType.has(item.type)) byType.set(item.type, []);
      byType.get(item.type).push(item);
    }
    for (const [type, typeItems] of byType) {
      console.log(`  ${type}: ${typeItems.length}`);
      if (type === "FIELD_MISMATCH") {
        const byField = new Map();
        for (const item of typeItems) {
          if (!byField.has(item.field)) byField.set(item.field, []);
          byField.get(item.field).push(item);
        }
        for (const [field, fieldItems] of byField) {
          console.log(`    field="${field}": ${fieldItems.length} mismatch(es), e.g. key=${JSON.stringify(fieldItems[0].key)} expected=${JSON.stringify(fieldItems[0].expected)} actual=${JSON.stringify(fieldItems[0].actual)}`);
        }
      } else if (type === "MISSING_IN_RECONSTRUCTION" || type === "EXTRA_IN_RECONSTRUCTION") {
        for (const item of typeItems.slice(0, 5)) {
          console.log(`    key=${JSON.stringify(item.key)}`);
        }
        if (typeItems.length > 5) console.log(`    ... and ${typeItems.length - 5} more`);
      } else if (type === "ORDER_MISMATCH") {
        console.log(`    expected order (first 10): ${JSON.stringify(typeItems[0].expectedOrder.slice(0, 10))}`);
        console.log(`    actual order (first 10):   ${JSON.stringify(typeItems[0].actualOrder.slice(0, 10))}`);
      }
    }
  }

  // Always-visible summary, regardless of node:test's default output verbosity.
  console.log(`\n=== FULL DISCREPANCY LIST (JSON) ===`);
  console.log(JSON.stringify(discrepancies, null, 2));
  if (process.env.DISCREPANCY_DUMP_PATH) {
    fs.writeFileSync(process.env.DISCREPANCY_DUMP_PATH, JSON.stringify(discrepancies, null, 2));
  }

  const unexpected = discrepancies.filter((d) => !isAllowedDiscrepancy(d));
  console.log(`\n${unexpected.length} of ${discrepancies.length} discrepancies are NOT in ALLOWED_DISCREPANCIES (these would fail the test)`);
  assert.deepEqual(unexpected, [], `${unexpected.length} unexpected discrepancy(ies) - see console output above for the full list, or set DISCREPANCY_DUMP_PATH to write it to a file`);
});
