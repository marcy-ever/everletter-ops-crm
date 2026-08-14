// Verifies GET /api/shared-state's table-backed behavior end to end,
// against real Postgres and the real POST/GET route handlers - not mocks.
// Covers three things (see lib/build-overrides-from-tables.ts's module
// comment for why componentOverrides/reviewed each need their own fetch,
// separate from the rest of the dataset):
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
// the real shared local Postgres tables - run these through `pnpm test:e2e`
// (not `node --test` directly), which passes `--test-concurrency=1`.
// Without it they race each other (node:test runs separate files in
// parallel by default, and there's only one physical database, not one per
// file) - see docs/testing.md.
import test from "node:test";
import assert from "node:assert/strict";
import { exceptionReviewKey, componentKey } from "../lib/keys.ts";
import { e2eSkipReason, loadAppJsSandbox, loadSpreadsheetRows, truncateAllTables } from "./e2e-helpers.mjs";

test("GET /api/shared-state: componentOverrides, reviewed exceptions, and status all round-trip correctly through the real POST/GET handlers", { skip: e2eSkipReason() }, async () => {
  const { POST, GET } = await import("../app/api/shared-state/route");
  const { writeImport } = await import("../lib/write-to-tables");
  const { getDb } = await import("../db");

  const db = getDb();
  await truncateAllTables(db);

  const rows = loadSpreadsheetRows();
  const appJs = loadAppJsSandbox();
  const clientSeed = appJs.buildSeedFromSpreadsheet(rows, "Import_20260812_181828.xlsx");

  await writeImport(clientSeed, db);

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
  // write-to-tables (an unrecognized/"Needs Review" Plan cell, or the genuine
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
  // didn't survive write-to-tables can never be matched by
  // writeReviewedException (it joins through mailings.app_mailing_id),
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
