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
  const order = { id: "sq-import-1", orderNumber: "202", createdOn: "2026-09-01T12:00:00Z", customerName: "Taylor Customer", customerEmail: "Taylor@Example.test", shippingAddress: "10 Pine St", addressLine1: "10 Pine St", city: "Denver", addressState: "CO", postalCode: "80202", billingAddress: "99 Buyer Lane", billingAddressLine1: "99 Buyer Lane", billingCity: "Boulder", billingState: "CO", billingPostalCode: "80301", billingCountry: "US", products: ["Letters from Ringo"], details: [], paymentState: "PAID", fulfillmentStatus: "PENDING", testMode: false, recipientName: "Jamie", character: "Ringo", plan: "6-month", giftMessage: "Love from Grandma", existing: false, warnings: [] };
  const staged = await stage(new Request("http://localhost/api/squarespace-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order }) }));
  const reviewId = (await staged.json()).reviewId;
  const input = { email: "taylor@example.test", customerName: "Taylor Customer", recipientName: "Jamie", addressLine1: "10 Pine St", addressLine2: "", city: "Denver", addressState: "CO", postalCode: "80202", character: "Ringo", plan: "6-month" };
  const importRequest = () => new Request("http://localhost/api/squarespace-reviews/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId, input }) });
  const attempts = await Promise.all([importReview(importRequest()), importReview(importRequest())]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await db.select().from(subscribers)).length, 1);
  assert.equal((await db.select().from(subscriptions)).length, 1);
  const importedOrders = await db.select().from(orders);
  assert.equal(importedOrders.length, 1);
  assert.equal(importedOrders[0].billingAddressLine1, "99 Buyer Lane");
  assert.equal((await db.select().from(mailings)).length, 12);
  const importedMailings = await db.select().from(mailings);
  assert.match(importedMailings.find((mailing) => mailing.letterNumber === 1).notes, /GIFT MESSAGE.*Love from Grandma/);
  assert.doesNotMatch(importedMailings.find((mailing) => mailing.letterNumber === 2).notes, /GIFT MESSAGE/);
  assert.equal((await db.select().from(squarespaceOrderReviews))[0].status, "Imported");
  assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.kind, "squarespaceImport"))).length, 1);
  const { GET: getMarketingAddresses } = await import("../app/api/marketing-addresses/route.ts");
  const marketing = await (await getMarketingAddresses()).json();
  assert.equal(marketing.rows.length, 1);
  assert.equal(marketing.rows[0].buyerName, "Taylor Customer");
  assert.match(marketing.rows[0].billingAddress, /99 Buyer Lane.*Boulder/);
  assert.match(marketing.rows[0].mailingAddress, /10 Pine St.*Denver/);
  const duplicate = await importReview(new Request("http://localhost/api/squarespace-reviews/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId, input }) }));
  assert.equal(duplicate.status, 409);
  assert.equal((await db.select().from(mailings)).length, 12);
});

test("North Pole product mapping preserves personalization and imports exactly one A9 mailing without duplicates", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { mailings, orders, squarespaceOrderReviews, subscriptions } = await import("../db/schema/index.ts");
  const { GET: preview } = await import("../app/api/squarespace-preview/route.ts");
  const { POST: stage } = await import("../app/api/squarespace-reviews/route.ts");
  const { POST: importReview } = await import("../app/api/squarespace-reviews/import/route.ts");
  const db = getDb();
  await truncateAllTables(db);
  const remote = {
    id: "sq-03085", orderNumber: "03085", createdOn: "2026-11-21T12:00:00Z", customerEmail: "amy@example.test", paymentState: "PAID", fulfillmentStatus: "PENDING", testmode: false,
    billingAddress: { firstName: "Amy", lastName: "Farkas", address1: "99 Buyer Lane", city: "Wilmington", state: "OH", postalCode: "45177", countryCode: "US" },
    shippingAddress: { firstName: "Joseph", lastName: "Howell", address1: "120 Springbird Court", city: "Wilmington", state: "OH", postalCode: "45177", countryCode: "US" },
    lineItems: [{ productName: "A Personalized Christmas Letter from the North Pole", quantity: 1, customizations: [
      { label: "Recipient Name", value: "Joseph Howell" },
      { label: "Child's first name", value: "Joe" },
      { label: "Preferred woodland character", value: "Ringo" },
      { label: "Tell us something wonderful about your child", value: "helped when I was in the hospital like such a good, big boy" },
    ] }],
  };
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SQUARESPACE_API_KEY;
  process.env.SQUARESPACE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ result: [remote], pagination: { hasNextPage: false } }), { status: 200 });
  let parsed;
  try {
    const response = await preview();
    parsed = (await response.json()).orders[0];
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SQUARESPACE_API_KEY; else process.env.SQUARESPACE_API_KEY = originalKey;
  }
  assert.equal(parsed.character, "North Pole");
  assert.equal(parsed.plan, "One-time");
  assert.equal(parsed.recipientName, "Joseph Howell");
  assert.equal(parsed.childFirstName, "Joe");
  assert.equal(parsed.preferredWoodlandCharacter, "Ringo");
  assert.match(parsed.northPolePersonalization, /helped when I was in the hospital/);
  assert.equal(parsed.giftMessage, "");
  assert.ok(!parsed.warnings.includes("Plan needs review"));
  assert.ok(!parsed.warnings.includes("Character needs review"));

  const staged = await stage(new Request("http://localhost/api/squarespace-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: parsed }) }));
  const reviewId = (await staged.json()).reviewId;
  const input = { email: parsed.customerEmail, customerName: parsed.customerName, recipientName: parsed.recipientName, addressLine1: parsed.addressLine1, addressLine2: parsed.addressLine2, city: parsed.city, addressState: parsed.addressState, postalCode: parsed.postalCode, character: parsed.character, plan: parsed.plan, childFirstName: parsed.childFirstName, preferredWoodlandCharacter: parsed.preferredWoodlandCharacter, northPolePersonalization: parsed.northPolePersonalization };
  const imported = await importReview(new Request("http://localhost/api/squarespace-reviews/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId, input }) }));
  assert.equal(imported.status, 200);
  const [storedOrder] = await db.select().from(orders);
  assert.equal(storedOrder.childFirstName, "Joe");
  assert.equal(storedOrder.preferredWoodlandCharacter, "Ringo");
  assert.match(storedOrder.northPolePersonalization, /hospital/);
  const [subscription] = await db.select().from(subscriptions);
  assert.equal(subscription.character, "North Pole");
  assert.equal(subscription.termType, "One-time");
  assert.equal(subscription.totalLettersExpected, 1);
  const importedMailings = await db.select().from(mailings);
  assert.equal(importedMailings.length, 1);
  assert.equal(importedMailings[0].letterNumber, 1);
  assert.equal(importedMailings[0].scheduledDate, "2026-12-01");
  assert.equal(importedMailings[0].recipientName, "Joseph Howell");
  assert.match(importedMailings[0].notes, /NORTH POLE CHILD FIRST NAME: Joe/);
  assert.match(importedMailings[0].notes, /PREFERRED WOODLAND CHARACTER: Ringo/);
  assert.match(importedMailings[0].notes, /NORTH POLE PERSONALIZATION:/);
  assert.doesNotMatch(importedMailings[0].notes, /GIFT MESSAGE/);
  assert.equal((await db.select().from(mailings)).length, 1);
  assert.equal((await db.select().from(squarespaceOrderReviews))[0].status, "Imported");
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

test("an already-staged legacy North Pole review is repaired safely without importing it", { skip }, async () => {
  const { getDb } = await import("../db/index.ts");
  const { mailings, squarespaceOrderReviews } = await import("../db/schema/index.ts");
  const { GET } = await import("../app/api/squarespace-reviews/route.ts");
  const db = getDb();
  await truncateAllTables(db);
  await db.insert(squarespaceOrderReviews).values({
    squarespaceOrderId: "sq-03085-legacy", orderNumber: "03085", stagedBy: "test@example.test",
    snapshot: { id: "sq-03085-legacy", orderNumber: "03085", createdOn: "2026-11-21T12:00:00Z", customerName: "Amy Farkas", customerEmail: "amy@example.test", shippingAddress: "120 Springbird Court", products: ["A Personalized Christmas Letter from the North Pole"], details: ["Recipient Name: Joseph Howell", "Child's first name: Joe", "Preferred woodland character: Ringo", "Tell us something wonderful about your child: Helped when I was in the hospital"], paymentState: "PAID", recipientName: "Joseph Howell", character: "Ringo", plan: "Needs Review", existing: false, warnings: ["Plan needs review"] },
  });
  const body = await (await GET()).json();
  assert.equal(body.reviews[0].order.character, "North Pole");
  assert.equal(body.reviews[0].order.plan, "One-time");
  assert.equal(body.reviews[0].order.childFirstName, "Joe");
  assert.equal(body.reviews[0].order.preferredWoodlandCharacter, "Ringo");
  assert.match(body.reviews[0].order.northPolePersonalization, /hospital/);
  assert.deepEqual(body.reviews[0].order.warnings, []);
  assert.equal((await db.select().from(mailings)).length, 0, "reading the repaired review must not approve or import it");
  assert.equal((await db.select().from(squarespaceOrderReviews))[0].status, "Pending");
});
