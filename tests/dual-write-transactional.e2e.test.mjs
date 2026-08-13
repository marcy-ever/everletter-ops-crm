// Verifies the actual behavior change from Option B Phase 2's transactional
// write path (see docs/schema-design.md's Phase 2 notes): a genuine,
// unexpected failure inside lib/dual-write.ts must now roll back the
// crm_state write too, not just fail silently while crm_state keeps the
// change. This is the real guarantee route.ts's db.transaction() is
// supposed to provide - this test exercises the actual dualWriteImport()
// function and a real Postgres transaction, not a mock.
//
// This file (and the other tests/*.e2e.test.mjs files) truncates/reimports
// the real shared local Postgres tables - when running more than one of
// these together, pass `node --test --test-concurrency=1 ...` or they'll
// race each other (node:test runs separate files in parallel by default,
// and there's only one physical database, not one per file).
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped, not
// failed, if it isn't available.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const hasDbUrl = !!process.env.DATABASE_URL;

test("a real failure inside dualWriteImport rolls back the crm_state write in the same transaction", { skip: !hasDbUrl }, async () => {
  const { dualWriteImport } = await import("../lib/dual-write");
  const { getDb } = await import("../db");
  const { crmState } = await import("../db/schema");
  const { subscribers } = await import("../db/schema/subscribers");

  const db = getDb();
  await db.execute(sql`TRUNCATE TABLE crm_state, exceptions, mailing_components, mailings, orders, subscriptions, subscribers RESTART IDENTITY CASCADE`);

  // A structurally valid seed for subscribers/subscriptions/recipients/
  // orders (so those writes genuinely happen inside the transaction first),
  // but with `mailings` missing entirely - runImport's orders loop does
  // `for (const m of seed.mailings)`, which throws a real TypeError once it
  // gets there, well after subscribers/subscriptions have already been
  // written to `tx`. This is not a contrived mock failure - it's the same
  // kind of genuine bug (bad/incomplete data reaching dual-write) the
  // transactional rewrite is meant to guard against.
  const brokenSeed = {
    subscribers: [{ subscriberId: "SUB-ROLLBACK-TEST", email: "rollback@example.com", displayName: "Rollback Test", status: "Active" }],
    recipients: [{ recipientId: "REC-ROLLBACK-TEST", subscriberId: "SUB-ROLLBACK-TEST", name: "Rollback Test", address: "1 Test St" }],
    subscriptions: [{ subscriptionId: "PLAN-ROLLBACK-TEST", subscriberId: "SUB-ROLLBACK-TEST", recipientId: "REC-ROLLBACK-TEST", plan: "Month-to-month", character: "Marley", startDate: "2026-01-01", endDate: "", activeState: "Active" }],
    orders: [{ orderId: "ORD-ROLLBACK-TEST", subscriberId: "SUB-ROLLBACK-TEST", sourceOrderNumber: "9999", createdOn: "2026-01-01" }],
    mailings: undefined, // deliberately broken - triggers a real TypeError partway through
    exceptions: [],
  };

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx
        .insert(crmState)
        .values({ id: "crmDataset::current", kind: "crmDataset", itemKey: "current", value: JSON.stringify({ seed: brokenSeed }) })
        .onConflictDoUpdate({ target: crmState.id, set: { value: "should not persist", updatedAt: sql`now()` } });
      await dualWriteImport(brokenSeed, tx);
    }),
    /mailings|iterable|undefined/i,
  );

  const crmStateRows = await db.select().from(crmState);
  const subscriberRows = await db.select().from(subscribers);

  assert.equal(crmStateRows.length, 0, "crm_state write should have rolled back along with the failed dual-write, not persisted independently");
  assert.equal(subscriberRows.length, 0, "the subscriber write that happened earlier in the SAME transaction should also have rolled back");
});

test("the real POST /api/shared-state handler commits normally when dual-write soft-skips (not an error) instead of rolling back", { skip: !hasDbUrl }, async () => {
  const { POST } = await import("../app/api/shared-state/route");
  const { getDb } = await import("../db");
  const { crmState } = await import("../db/schema");
  const { sql: sqlTag } = await import("drizzle-orm");

  const db = getDb();
  await db.execute(sqlTag`TRUNCATE TABLE crm_state RESTART IDENTITY CASCADE`);

  // A well-formed mailingStatus key that won't match any real mailing row -
  // dualWriteMailingStatus soft-skips this (findMailingByAppKey logs "no
  // confident match" and returns null) without throwing. The crm_state
  // write must still commit - a soft skip is not the failure case the
  // transaction is meant to guard against.
  const request = new Request("http://localhost/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "mailingStatus", key: "MAIL-DOES-NOT-EXIST::999", value: "Mailed" }),
  });

  const response = await POST(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true });

  const rows = await db.select().from(crmState).where(sqlTag`${crmState.id} = 'mailingStatus::MAIL-DOES-NOT-EXIST::999'`);
  assert.equal(rows.length, 1, "crm_state write should have committed even though the dual-write soft-skipped");
});
