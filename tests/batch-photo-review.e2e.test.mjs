import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";

const skip = e2eSkipReason({ requiresFixture: false });

test("a batch photo review can be assigned to a customer and marked mailed", { skip }, async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "everletter-batch-review-"));
  process.env.PHOTO_STORAGE_DIR = storage;
  try {
    const { getDb } = await import("../db/index.ts");
    const { writeImport } = await import("../lib/write-to-tables.ts");
    const { mailingPhotoReviews, mailingProofs, mailings } = await import("../db/schema/index.ts");
    const { GET, POST } = await import("../app/api/batch-mailing-photo/reviews/route.ts");
    const db = getDb();
    await truncateAllTables(db);

    const seed = buildSeedFromSpreadsheet([{
      "Order ID": "BATCH-PHOTO-1", "Original Order Date": "2026-08-01",
      "Customer Name and Address": "Review Customer\n1 Camera Way\nDenver, CO 80000",
      Character: "Marley", "Letter Number": "1", "Ship Date": "2026-09-01",
      Subscription: "6-month", Status: "Ready to Mail", "Active?": "Yes", Email: "review@example.test",
    }], "batch-photo-test.xlsx", new Date("2026-08-15T12:00:00Z"), []);
    await db.transaction((tx) => writeImport(seed, tx));

    const [storedMailing] = await db.select().from(mailings).where(eq(mailings.appMailingId, seed.mailings[0].mailingId));
    fs.writeFileSync(path.join(storage, "batch.jpg"), new Uint8Array([255, 216, 255, 217]));
    const [review] = await db.insert(mailingPhotoReviews).values({
      storageKey: "batch.jpg", originalName: "batch.jpg", contentType: "image/jpeg", sizeBytes: 4,
      batchDate: "2026-09-01", extractedText: "Revew Customer", suggestedMailingId: storedMailing.id,
    }).returning();

    const listResponse = await GET();
    const list = await listResponse.json();
    assert.equal(list.reviews.length, 1);
    assert.equal(list.reviews[0].suggestedName, "Review Customer");

    const confirmResponse = await POST(new Request("http://localhost/api/batch-mailing-photo/reviews", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: review.id, mailingId: storedMailing.id }),
    }));
    assert.equal(confirmResponse.status, 200);

    const [resolved] = await db.select().from(mailingPhotoReviews).where(eq(mailingPhotoReviews.id, review.id));
    const [mailed] = await db.select().from(mailings).where(eq(mailings.id, storedMailing.id));
    const [proof] = await db.select().from(mailingProofs).where(eq(mailingProofs.mailingId, storedMailing.id));
    assert.equal(resolved.status, "Resolved");
    assert.equal(mailed.status, "Mailed");
    assert.ok(proof);
    assert.ok(fs.existsSync(path.join(storage, proof.storageKey)));
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});
