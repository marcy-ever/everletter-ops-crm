import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";

const skip = e2eSkipReason({ requiresFixture: false });

test("Ashley camera upload stores proof, marks the mailing Mailed, and makes the photo available by customer", { skip }, async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "everletter-proof-"));
  process.env.PHOTO_STORAGE_DIR = storage;
  try {
    const { getDb } = await import("../db/index.ts");
    const { writeImport } = await import("../lib/write-to-tables.ts");
    const { mailingProofs, mailings, auditEvents } = await import("../db/schema/index.ts");
    const { eq } = await import("drizzle-orm");
    const { POST, GET } = await import("../app/api/mailing-proof/route.ts");
    const { GET: GET_IMAGE } = await import("../app/api/mailing-proof/[id]/route.ts");
    const db = getDb();
    await truncateAllTables(db);
    await db.delete(auditEvents);
    const seed = buildSeedFromSpreadsheet([{
      "Order ID": "PHOTO-1", "Original Order Date": "2026-08-01",
      "Customer Name and Address": "Photo Customer\n1 Camera Way\nDenver, CO 80000",
      Character: "Marley", "Letter Number": "1", "Ship Date": "2026-09-01",
      Subscription: "6-month", Status: "Ready to Mail", "Active?": "Yes", Email: "photo@example.test",
    }], "photo-test.xlsx", new Date("2026-08-15T12:00:00Z"), []);
    await db.transaction((tx) => writeImport(seed, tx));
    const mailing = seed.mailings[0];
    const form = new FormData();
    form.set("mailingId", mailing.mailingId);
    form.set("sourceRow", String(mailing.sourceRow));
    form.set("photo", new File([new Uint8Array([255, 216, 255, 217])], "proof.jpg", { type: "image/jpeg" }));
    const response = await POST(new Request("http://localhost/api/mailing-proof", { method: "POST", body: form }));
    assert.equal(response.status, 200);
    const body = await response.json();
    const [proof] = await db.select().from(mailingProofs);
    assert.equal(proof.id, body.proofId);
    assert.ok(fs.existsSync(path.join(storage, proof.storageKey)));
    const [storedMailing] = await db.select().from(mailings).where(eq(mailings.appMailingId, mailing.mailingId));
    assert.equal(storedMailing.status, "Mailed");
    const listResponse = await GET(new Request(`http://localhost/api/mailing-proof?subscriberId=${mailing.subscriberId}`));
    const list = await listResponse.json();
    assert.equal(list.proofs.length, 1);
    assert.equal(list.proofs[0].recipientName, "Photo Customer");
    const imageResponse = await GET_IMAGE(new Request("http://localhost"), { params: Promise.resolve({ id: String(proof.id) }) });
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), new Uint8Array([255, 216, 255, 217]));
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});
