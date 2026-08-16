// Verifies lib/write-to-tables.ts's transactional guarantee: a genuine,
// unexpected failure must roll back every write that happened earlier in
// the same transaction, not just fail silently partway through. This is
// the real guarantee route.ts's db.transaction() is supposed to provide -
// this test exercises the actual writeImport() function and a real
// Postgres transaction, not a mock. These tests assert on the normalized
// tables directly - see each test's own comment for why the two tests
// differ in what they can prove.
//
// This file (and the other tests/*.e2e.test.mjs files) truncates/reimports
// the real shared local Postgres tables - run these through `pnpm test:e2e`
// (not `node --test` directly), which passes `--test-concurrency=1`.
// Without it they race each other (node:test runs separate files in
// parallel by default, and there's only one physical database, not one per
// file) - see docs/testing.md.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped, not
// failed, if it isn't available.
import test from "node:test";
import assert from "node:assert/strict";
import { countRows } from "./db-test-helpers.mjs";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";

test("a real failure inside writeImport rolls back every normalized-table write from the same transaction", { skip: e2eSkipReason({ requiresFixture: false }) }, async () => {
  const { writeImport } = await import("../lib/write-to-tables");
  const { getDb } = await import("../db");
  const { subscribers } = await import("../db/schema/subscribers");
  const { subscriptions } = await import("../db/schema/subscriptions");

  const db = getDb();
  await truncateAllTables(db);

  // A structurally valid seed for subscribers/subscriptions/recipients/
  // orders (so those writes genuinely happen inside the transaction first),
  // but with `mailings` missing entirely - runImport's orders loop does
  // `for (const m of seed.mailings)`, which throws a real TypeError once it
  // gets there, well after subscribers/subscriptions have already been
  // written to `tx`. This is not a contrived mock failure - it's the same
  // kind of genuine bug (bad/incomplete data reaching write-to-tables) the
  // transactional rewrite is meant to guard against.
  const brokenSeed = {
    subscribers: [{ subscriberId: "SUB-ROLLBACK-TEST", email: "rollback@example.com", displayName: "Rollback Test", status: "Active" }],
    recipients: [{ recipientId: "REC-ROLLBACK-TEST", subscriberId: "SUB-ROLLBACK-TEST", name: "Rollback Test", address: "1 Test St" }],
    subscriptions: [{ subscriptionId: "PLAN-ROLLBACK-TEST", subscriberId: "SUB-ROLLBACK-TEST", recipientId: "REC-ROLLBACK-TEST", plan: "Month-to-month", character: "Marley", startDate: "2026-01-01", endDate: "", activeState: "Active" }],
    orders: [{ orderId: "ORD-ROLLBACK-TEST", subscriberId: "SUB-ROLLBACK-TEST", sourceOrderNumber: "9999", createdOn: "2026-01-01" }],
    mailings: undefined, // deliberately broken - triggers a real TypeError partway through
    exceptions: [],
  };

  // Mirrors route.ts's POST exactly: writeImport is the only thing
  // inside the transaction.
  await assert.rejects(
    db.transaction(async (tx) => {
      await writeImport(brokenSeed, tx);
    }),
    /mailings|iterable|undefined/i,
  );

  assert.equal(await countRows(db, subscribers), 0, "the subscriber write that happened earlier in the SAME transaction should have rolled back");
  assert.equal(await countRows(db, subscriptions), 0, "the subscription write that happened earlier in the SAME transaction should have rolled back too");
});

test("the real POST /api/shared-state handler commits (200/{ok:true}) when write-to-tables soft-skips (not an error) instead of rolling back", { skip: e2eSkipReason({ requiresFixture: false }) }, async () => {
  const { POST } = await import("../app/api/shared-state/route");
  const { getDb } = await import("../db");

  const db = getDb();
  await truncateAllTables(db);

  // A well-formed mailingStatus key that won't match any real mailing row -
  // writeMailingStatus soft-skips this (findMailingByAppKey logs "no
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
  assert.equal(body.ok, true);
  // POST now also returns the post-write change marker (lib/change-marker.ts,
  // added for the "someone else changed something" staleness feature) -
  // unrelated to what this test itself proves (a soft-skip still commits),
  // so only its presence/shape is checked here, not a specific value.
  assert.ok(typeof body.marker === "number" || body.marker === null);
});
