// Verifies GET /api/shared-state's new table-backed behavior end to end,
// against real Postgres and the real POST/GET route handlers - not mocks.
// Covers exactly the three things flagged as real regression risk when GET
// stopped reading the crm_state blob (see the task this was written for and
// lib/build-overrides-from-tables.ts's module comment):
//  1. componentOverrides is populated correctly after a real componentStatus
//     POST, using the real componentKey() format.
//  2. marking an exception reviewed (POST) makes GET's `reviewed` list
//     contain the exact key a client-side activeExceptions() would check
//     for, while dataset.exceptions and summary.exceptionCount still count
//     it (reviewed filtering stays a client-side concern).
//  3. a mailingStatus POST is reflected directly in the next GET's
//     dataset.mailings[].status with no override needed - statusOverrides
//     is always {}.
//
// Requires a real local Postgres (DATABASE_URL) and the real test
// spreadsheet at testing/Import_20260812_181828.xlsx - skipped, not failed,
// if either is missing.
//
// This file (and the other tests/*.e2e.test.mjs files) truncates/reimports
// the real shared local Postgres tables - when running more than one of
// these together, pass `node --test --test-concurrency=1 ...` or they'll
// race each other (node:test runs separate files in parallel by default,
// and there's only one physical database, not one per file).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { exceptionReviewKey, componentKey } from "../lib/keys.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XLSX_PATH = path.join(ROOT, "testing/Import_20260812_181828.xlsx");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const hasFixture = fs.existsSync(XLSX_PATH);
const hasDbUrl = !!process.env.DATABASE_URL;

function loadAppJsSandbox() {
  const source = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  function stubElement() {
    return {
      addEventListener() {}, querySelector: () => stubElement(), querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, dataset: {},
      getAttribute: () => null, setAttribute() {}, set innerHTML(_v) {}, get innerHTML() { return ""; },
    };
  }
  const sandbox = {
    document: { querySelector: () => stubElement(), querySelectorAll: () => [] },
    window: { EVERLETTER_SEED: undefined, location: { hash: "" } },
    console, localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    TextEncoder,
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "public/app.js" }).runInContext(sandbox);
  return sandbox;
}

test("GET /api/shared-state: componentOverrides, reviewed exceptions, and status all round-trip correctly through the real POST/GET handlers", { skip: !hasFixture || !hasDbUrl }, async () => {
  const { POST, GET } = await import("../app/api/shared-state/route");
  const { dualWriteImport } = await import("../lib/dual-write");
  const { getDb } = await import("../db");

  const db = getDb();
  await db.execute(sql`TRUNCATE TABLE crm_state, exceptions, mailing_components, mailings, orders, subscriptions, subscribers RESTART IDENTITY CASCADE`);

  const workbook = XLSX.read(fs.readFileSync(XLSX_PATH), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes("mailing")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
  const appJs = loadAppJsSandbox();
  const clientSeed = appJs.buildSeedFromSpreadsheet(rows, "Import_20260812_181828.xlsx");

  await dualWriteImport(clientSeed, db);

  async function post(body) {
    const response = await POST(new Request("http://localhost/api/shared-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, 200, `POST ${body.kind} failed: ${JSON.stringify(await response.json().catch(() => null))}`);
  }
  async function get() {
    const response = await GET();
    assert.equal(response.status, 200);
    return response.json();
  }

  // Two known, already-documented categories of mailing never survive
  // dual-write (an unrecognized/"Needs Review" Plan cell, or the genuine
  // ORD-2858 spreadsheet duplicate - see lib/build-dataset-from-tables.ts's
  // module comment) - picking a target mailing at random risks landing on
  // one of those and testing a mailing GET can never see. Restrict to
  // mailings guaranteed to survive.
  const survivingMailings = clientSeed.mailings.filter((m) => m.plan !== "Needs Review" && m.orderId !== "ORD-2858");
  assert.ok(survivingMailings.length >= 2, "expected at least 2 surviving mailings in the real test file");

  // --- 1. componentOverrides ---
  const targetMailing = survivingMailings[0];
  const targetMailingKey = `${targetMailing.mailingId}::${targetMailing.sourceRow}`;
  await post({ kind: "componentStatus", key: `${targetMailingKey}::envelope`, value: "Printed" });

  // --- 2. reviewed exception ---
  // Same reasoning as survivingMailings above: an exception whose mailing
  // didn't survive dual-write can never be matched by
  // dualWriteReviewedException (it joins through mailings.app_mailing_id),
  // so exceptions.reviewed would never actually get set - pick one backed
  // by a surviving mailing so this test exercises a real, matchable case.
  const survivingMailingIds = new Set(survivingMailings.map((m) => m.mailingId));
  const targetException = clientSeed.exceptions.find((e) => survivingMailingIds.has(e.mailingId));
  assert.ok(targetException, "expected at least one exception backed by a surviving mailing in the real test file");
  const targetExceptionKey = exceptionReviewKey(targetException);
  await post({ kind: "reviewedException", key: targetExceptionKey, value: "1" });

  // --- 3. mailing status ---
  const statusMailing = survivingMailings[1];
  const statusMailingKey = `${statusMailing.mailingId}::${statusMailing.sourceRow}`;
  const newStatus = statusMailing.status === "Mailed" ? "To Prepare" : "Mailed";
  await post({ kind: "mailingStatus", key: statusMailingKey, value: newStatus });

  const body = await get();

  // 1. componentOverrides populated with the real componentKey() format
  const expectedComponentKey = componentKey({ mailingId: targetMailing.mailingId, sourceRow: targetMailing.sourceRow }, "envelope");
  assert.equal(body.componentOverrides[expectedComponentKey], "Printed");

  // 2a. reviewed contains the exact key a client would check
  assert.ok(body.reviewed.includes(targetExceptionKey), `expected reviewed to include ${targetExceptionKey}, got ${JSON.stringify(body.reviewed)}`);
  // 2b. dataset.exceptions still contains the reviewed exception (buildExceptions() is unfiltered)
  const stillPresent = body.dataset.exceptions.some((e) => exceptionReviewKey(e) === targetExceptionKey);
  assert.ok(stillPresent, "the reviewed exception should still be present in dataset.exceptions - review filtering is a client-side concern");
  // 2c. summary.exceptionCount still counts it (unaffected by review status)
  assert.equal(body.dataset.summary.exceptionCount, body.dataset.exceptions.length);
  // 2d. simulating app.js's real activeExceptions() (state.seed.exceptions.filter(item => !isExceptionReviewed(item))) excludes it
  const reviewedSet = new Set(body.reviewed);
  const activeExceptions = body.dataset.exceptions.filter((item) => !(reviewedSet.has(exceptionReviewKey(item)) || reviewedSet.has(item.exceptionId)));
  assert.ok(!activeExceptions.some((e) => exceptionReviewKey(e) === targetExceptionKey), "a client-side activeExceptions() filter should exclude the reviewed exception");

  // 3. status persisted directly on the mailing, no override needed
  assert.deepEqual(body.statusOverrides, {});
  const reconstructedMailing = body.dataset.mailings.find((m) => m.mailingId === statusMailing.mailingId && String(m.sourceRow) === String(statusMailing.sourceRow));
  assert.ok(reconstructedMailing, "the status-updated mailing should still be present in dataset.mailings");
  assert.equal(reconstructedMailing.status, newStatus);
});
