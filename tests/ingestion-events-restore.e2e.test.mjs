// Proves the restore mechanism described in docs/data-recovery.md
// actually works: import A, import B, restore A via the real
// devops/restore-ingestion-event.mjs script (run as a real subprocess -
// not its internals called directly, so this exercises the actual tool a
// human would run), confirm the tables match A exactly - not just a row
// count, every subscriber/mailing id and field.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped,
// not failed, if it isn't available. Run through `pnpm test:e2e`.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { e2eSkipReason, truncateAllTables, ROOT } from "./e2e-helpers.mjs";

const execFileAsync = promisify(execFile);
const skip = e2eSkipReason({ requiresFixture: false });

function buildMailing(n) {
  const id = `R${n}`;
  return {
    subscriberId: `SUB-${id}`,
    subscriptionId: `PLAN-${id}`,
    recipientId: `REC-${id}`,
    orderId: `ORD-${id}`,
    mailingId: `MAIL-${id}`,
    character: "Marley",
    recipientName: `Restore Test ${id}`,
    letterNumber: 1,
    shipDate: "2026-08-15",
    status: "To Prepare",
    activeState: "Active",
    notes: "",
    sourceRow: n,
  };
}

function buildSeed(mailingSpecs) {
  return {
    subscribers: mailingSpecs.map((m) => ({ subscriberId: m.subscriberId, email: `${m.subscriberId}@example.test`, displayName: m.recipientName, status: "Active" })),
    recipients: mailingSpecs.map((m) => ({ recipientId: m.recipientId, subscriberId: m.subscriberId, name: m.recipientName, address: "1 Restore Test St" })),
    subscriptions: mailingSpecs.map((m) => ({
      subscriptionId: m.subscriptionId,
      subscriberId: m.subscriberId,
      recipientId: m.recipientId,
      plan: "Month-to-month",
      character: m.character,
      startDate: "2026-01-01",
      endDate: "",
      activeState: "Active",
    })),
    orders: mailingSpecs.map((m) => ({ orderId: m.orderId, subscriberId: m.subscriberId, sourceOrderNumber: m.orderId, createdOn: "2026-01-01" })),
    mailings: mailingSpecs.map((m) => ({
      mailingId: m.mailingId,
      subscriptionId: m.subscriptionId,
      recipientId: m.recipientId,
      orderId: m.orderId,
      character: m.character,
      recipientName: m.recipientName,
      letterNumber: m.letterNumber,
      shipDate: m.shipDate,
      status: m.status,
      activeState: m.activeState,
      notes: m.notes,
      sourceRow: m.sourceRow,
    })),
    exceptions: [],
    automationRules: [],
    summary: {},
  };
}

function postRequest(body) {
  return new Request("http://localhost/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function buildCrmDatasetBody(seed, { sourceName, confirmLargeDelete } = {}) {
  const value = JSON.stringify({ seed, sourceName, uploadedAt: new Date().toISOString(), summary: {} });
  const body = { kind: "crmDataset", key: "current", value };
  if (confirmLargeDelete !== undefined) body.confirmLargeDelete = confirmLargeDelete;
  return JSON.stringify(body);
}

// Snapshots every mailings/subscribers row, sorted by id, with only the
// fields that matter for "does this match dataset A" - id churn in
// unrelated columns (e.g. a default timestamp) shouldn't fail this.
async function snapshot(db) {
  const { mailings } = await import("../db/schema/mailings");
  const { subscribers } = await import("../db/schema/subscribers");
  const mailingRows = await db.select({ id: mailings.id, subscriptionId: mailings.subscriptionId, recipientName: mailings.recipientName, scheduledDate: mailings.scheduledDate, status: mailings.status }).from(mailings);
  const subscriberRows = await db.select({ id: subscribers.id, email: subscribers.email, name: subscribers.name }).from(subscribers);
  return {
    mailings: mailingRows.sort((a, b) => a.id.localeCompare(b.id)),
    subscribers: subscriberRows.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

test("import A, import B, restore A via the real devops/restore-ingestion-event.mjs script, tables match A exactly", { skip }, async () => {
  const { getDb } = await import("../db");
  const { POST } = await import("../app/api/shared-state/route");
  const { ingestionEvents } = await import("../db/schema/ingestion_events");
  const { desc } = await import("drizzle-orm");

  const db = getDb();
  await truncateAllTables(db);
  await db.delete(ingestionEvents);

  const datasetA = buildSeed([buildMailing(1), buildMailing(2), buildMailing(3)]);
  const responseA = await POST(postRequest(buildCrmDatasetBody(datasetA, { sourceName: "dataset-A.xlsx" })));
  assert.equal(responseA.status, 200, `importing dataset A failed: ${JSON.stringify(await responseA.json().catch(() => null))}`);
  const snapshotA = await snapshot(db);
  assert.equal(snapshotA.mailings.length, 3);

  const eventRowsAfterA = await db.select({ id: ingestionEvents.id }).from(ingestionEvents).orderBy(desc(ingestionEvents.id)).limit(1);
  assert.equal(eventRowsAfterA.length, 1, "importing dataset A should have recorded exactly one ingestion_events row");
  const eventIdForA = eventRowsAfterA[0].id;

  // Dataset B: entirely disjoint mailings from A, so importing it removes
  // all 3 of A's - needs the override (this isn't what this test is
  // proving, so just force it through).
  const datasetB = buildSeed([buildMailing(101), buildMailing(102)]);
  const responseB = await POST(postRequest(buildCrmDatasetBody(datasetB, { sourceName: "dataset-B.xlsx", confirmLargeDelete: true })));
  assert.equal(responseB.status, 200, `importing dataset B failed: ${JSON.stringify(await responseB.json().catch(() => null))}`);
  const snapshotB = await snapshot(db);
  assert.equal(snapshotB.mailings.length, 2);
  assert.notDeepEqual(snapshotB.mailings, snapshotA.mailings, "sanity check: B must actually differ from A, or restoring wouldn't prove anything");

  // Restore A via the REAL script, as a real subprocess - not calling its
  // internals directly, so this exercises the actual devops tool.
  const scriptPath = path.join(ROOT, "devops/restore-ingestion-event.mjs");
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--experimental-loader=./tests/ts-extensionless-loader.mjs", scriptPath, String(eventIdForA)],
    { cwd: ROOT, env: process.env },
  );
  assert.match(stdout, /Restored\./);

  const snapshotAfterRestore = await snapshot(db);
  assert.deepEqual(snapshotAfterRestore, snapshotA, "after restoring event A, the tables must match dataset A's own post-import snapshot exactly - not B, not some merge of the two");
});
