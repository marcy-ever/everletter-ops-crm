// Verifies the actual behavior change from Option B Phase 2's transactional
// write path (see docs/schema-design.md's Phase 2 notes): a genuine,
// unexpected failure inside lib/dual-write.ts must roll back every write
// that happened earlier in the same transaction, not just fail silently
// partway through. This is the real guarantee route.ts's db.transaction()
// is supposed to provide - this test exercises the actual dualWriteImport()
// function and a real Postgres transaction, not a mock.
//
// As of the crm_state-write-removal step, POST no longer writes crm_state
// at all (the table still exists, untouched, as a rollback path - see
// docs/schema-design.md's Phase 2 notes), so these tests assert on the
// normalized tables directly rather than on a crm_state row - see each
// test's own comment for why the two tests differ in what they can prove.
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
import { countRows } from "./db-test-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const hasDbUrl = !!process.env.DATABASE_URL;

test("a real failure inside dualWriteImport rolls back every normalized-table write from the same transaction", { skip: !hasDbUrl }, async () => {
  const { dualWriteImport } = await import("../lib/dual-write");
  const { getDb } = await import("../db");
  const { subscribers } = await import("../db/schema/subscribers");
  const { subscriptions } = await import("../db/schema/subscriptions");

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

  // Mirrors route.ts's POST exactly: dualWriteImport is the only thing
  // inside the transaction now that crm_state isn't written here.
  await assert.rejects(
    db.transaction(async (tx) => {
      await dualWriteImport(brokenSeed, tx);
    }),
    /mailings|iterable|undefined/i,
  );

  assert.equal(await countRows(db, subscribers), 0, "the subscriber write that happened earlier in the SAME transaction should have rolled back");
  assert.equal(await countRows(db, subscriptions), 0, "the subscription write that happened earlier in the SAME transaction should have rolled back too");
});

test("the real POST /api/shared-state handler commits (200/{ok:true}) when dual-write soft-skips (not an error) instead of rolling back", { skip: !hasDbUrl }, async () => {
  const { POST } = await import("../app/api/shared-state/route");
  const { getDb } = await import("../db");

  const db = getDb();
  await db.execute(sql`TRUNCATE TABLE crm_state, exceptions, mailing_components, mailings, orders, subscriptions, subscribers RESTART IDENTITY CASCADE`);

  // A well-formed mailingStatus key that won't match any real mailing row -
  // dualWriteMailingStatus soft-skips this (findMailingByAppKey logs "no
  // confident match" and returns null) without throwing and without
  // writing anything to any table. That's exactly why this test can't
  // point at a row as proof the transaction committed cleanly - a
  // deliberate no-op writes nothing whether the transaction commits or
  // rolls back, so a row check here would be checking nothing meaningful.
  // The actual proof that this request succeeded is its own response.
  const request = new Request("http://localhost/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "mailingStatus", key: "MAIL-DOES-NOT-EXIST::999", value: "Mailed" }),
  });

  const response = await POST(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true });
});
