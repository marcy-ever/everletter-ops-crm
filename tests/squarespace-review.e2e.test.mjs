import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";

const skip = e2eSkipReason({ requiresFixture: false });

test("a Squarespace order can be safely staged once without creating customer records", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { auditEvents, squarespaceOrderReviews, subscribers } = await import("../db/schema/index.ts");
  const { GET, POST } = await import("../app/api/squarespace-reviews/route.ts");
  const db = getDb();
  await truncateAllTables(db);
  await db.delete(auditEvents);
  const order = { id: "sq-safe-1", orderNumber: "101", createdOn: "2026-09-01T12:00:00Z", customerName: "Safe Review", customerEmail: "review@example.test", shippingAddress: "1 Main St", products: ["Marley – Monthly Subscription"], details: [], paymentState: "PAID", recipientName: "Jamie", character: "Marley", plan: "Month-to-month", existing: false, warnings: [] };
  const response = await POST(new Request("http://localhost/api/squarespace-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order }) }));
  assert.equal(response.status, 200);
  assert.equal((await db.select().from(squarespaceOrderReviews)).length, 1);
  assert.equal((await db.select().from(subscribers)).length, 0, "staging must not create a customer");
  assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.kind, "squarespaceReview"))).length, 1);
  const duplicate = await POST(new Request("http://localhost/api/squarespace-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order }) }));
  assert.equal(duplicate.status, 409);
  const listed = await GET();
  assert.equal((await listed.json()).reviews.length, 1);
});

test("a confirmed Squarespace review creates the customer, subscription, order, and mailing schedule exactly once", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { auditEvents, mailings, orders, squarespaceOrderReviews, subscribers, subscriptions } = await import("../db/schema/index.ts");
  const { POST: stage } = await import("../app/api/squarespace-reviews/route.ts");
  const { POST: importReview } = await import("../app/api/squarespace-reviews/import/route.ts");
  const db = getDb();
  await truncateAllTables(db);
  await db.delete(auditEvents);
  const order = { id: "sq-import-1", orderNumber: "202", createdOn: "2026-09-01T12:00:00Z", customerName: "Taylor Customer", customerEmail: "Taylor@Example.test", shippingAddress: "10 Pine St", addressLine1: "10 Pine St", city: "Denver", addressState: "CO", postalCode: "80202", products: ["Letters from Ringo"], details: [], paymentState: "PAID", fulfillmentStatus: "PENDING", testMode: false, recipientName: "Jamie", character: "Ringo", plan: "6-month", existing: false, warnings: [] };
  const staged = await stage(new Request("http://localhost/api/squarespace-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order }) }));
  const reviewId = (await staged.json()).reviewId;
  const input = { email: "taylor@example.test", customerName: "Taylor Customer", recipientName: "Jamie", addressLine1: "10 Pine St", addressLine2: "", city: "Denver", addressState: "CO", postalCode: "80202", character: "Ringo", plan: "6-month" };
  const imported = await importReview(new Request("http://localhost/api/squarespace-reviews/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId, input }) }));
  assert.equal(imported.status, 200);
  assert.equal((await db.select().from(subscribers)).length, 1);
  assert.equal((await db.select().from(subscriptions)).length, 1);
  assert.equal((await db.select().from(orders)).length, 1);
  assert.equal((await db.select().from(mailings)).length, 12);
  assert.equal((await db.select().from(squarespaceOrderReviews))[0].status, "Imported");
  assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.kind, "squarespaceImport"))).length, 1);
  const duplicate = await importReview(new Request("http://localhost/api/squarespace-reviews/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId, input }) }));
  assert.equal(duplicate.status, 409);
  assert.equal((await db.select().from(mailings)).length, 12);
});

test("automatic Squarespace intake establishes a safe baseline, then stages only newer paid orders", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { auditEvents, integrationSyncState, squarespaceOrderReviews } = await import("../db/schema/index.ts");
  const { POST: sync } = await import("../app/api/squarespace-sync/route.ts");
  const db = getDb();
  await truncateAllTables(db);
  await db.delete(auditEvents);
  const remote = (id, number, createdOn) => ({ id, orderNumber: number, createdOn, customerEmail: `${id}@example.test`, paymentState: "PAID", fulfillmentStatus: "PENDING", testmode: false, shippingAddress: { firstName: "Taylor", lastName: "Customer", address1: "10 Pine St", city: "Denver", state: "CO", postalCode: "80202" }, lineItems: [{ productName: "Letters from Ringo", variantOptions: [{ optionName: "Character", value: "Letters from Ringo" }, { optionName: "Plan", value: "Monthly" }], customizations: [{ label: "Recipient Name", value: "Jamie" }] }] });
  let result = [remote("historical", "300", "2026-09-01T12:00:00Z")];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result, pagination: { hasNextPage: false } }), { status: 200 });
  try {
    const initialized = await sync();
    assert.equal((await initialized.json()).staged, 0);
    assert.equal((await db.select().from(integrationSyncState)).length, 1);
    assert.equal((await db.select().from(squarespaceOrderReviews)).length, 0, "historical orders must not flood Needs Review");
    result = [remote("new-order", "301", "2026-09-02T12:00:00Z"), ...result];
    const checked = await sync();
    assert.equal((await checked.json()).staged, 1);
    assert.equal((await db.select().from(squarespaceOrderReviews)).length, 1);
    assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.kind, "squarespaceAutoReview"))).length, 1);
    const repeated = await sync();
    assert.equal((await repeated.json()).staged, 0);
    assert.equal((await db.select().from(squarespaceOrderReviews)).length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("an unwanted Squarespace review can be ignored without creating customer data", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { auditEvents, squarespaceOrderReviews, subscribers } = await import("../db/schema/index.ts");
  const { POST: stage } = await import("../app/api/squarespace-reviews/route.ts");
  const { POST: ignore } = await import("../app/api/squarespace-reviews/[id]/route.ts");
  const db = getDb();
  await truncateAllTables(db);
  await db.delete(auditEvents);
  const order = { id: "sq-ignore-1", orderNumber: "401", createdOn: "2026-09-02T12:00:00Z", customerName: "Ignore Me", customerEmail: "ignore@example.test", shippingAddress: "1 Main St", products: ["Not an Everletter order"], details: [], paymentState: "PAID", recipientName: "Jamie", character: "Needs Review", plan: "Needs Review", existing: false, warnings: ["Character needs review"] };
  const staged = await stage(new Request("http://localhost/api/squarespace-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order }) }));
  const reviewId = (await staged.json()).reviewId;
  const response = await ignore(new Request(`http://localhost/api/squarespace-reviews/${reviewId}`, { method: "POST" }), { params: Promise.resolve({ id: String(reviewId) }) });
  assert.equal(response.status, 200);
  assert.equal((await db.select().from(squarespaceOrderReviews))[0].status, "Ignored");
  assert.equal((await db.select().from(subscribers)).length, 0);
  assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.kind, "squarespaceIgnored"))).length, 1);
  const repeated = await ignore(new Request(`http://localhost/api/squarespace-reviews/${reviewId}`, { method: "POST" }), { params: Promise.resolve({ id: String(reviewId) }) });
  assert.equal(repeated.status, 409);
});

test("a pending Squarespace renewal links to its existing customer by email", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { squarespaceOrderReviews, subscribers } = await import("../db/schema/index.ts");
  const { GET } = await import("../app/api/squarespace-reviews/route.ts");
  const db = getDb();
  await db.delete(squarespaceOrderReviews);
  await db.insert(subscribers).values({ id: "SUB-LINK", email: "Marcy@Example.test", name: "Marcy Customer" });
  await db.insert(squarespaceOrderReviews).values({ squarespaceOrderId: "sq-link-1", orderNumber: "501", stagedBy: "test@example.test", snapshot: { id: "sq-link-1", orderNumber: "501", createdOn: "2026-09-02T12:00:00Z", customerName: "Marcy Customer", customerEmail: "marcy@example.test", shippingAddress: "1 Main St", products: ["Letters"], details: [], paymentState: "PAID", recipientName: "Jamie", character: "Ringo", plan: "Month-to-month", existing: false, warnings: [] } });
  const response = await GET();
  const body = await response.json();
  assert.equal(body.reviews[0].order.subscriberId, "SUB-LINK");
});
