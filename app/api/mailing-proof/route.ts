import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, mailingProofs, mailings, subscriptions } from "@/db/schema";
import { writeMailingStatus } from "@/lib/write-to-tables";
import { currentChangeMarker } from "@/lib/change-marker";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const EXTENSIONS: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif" };

function storageDirectory(): string {
  return process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const subscriberId = url.searchParams.get("subscriberId")?.trim();
    const batchDate = url.searchParams.get("batchDate")?.trim();
    if (!subscriberId && !batchDate) return Response.json({ error: "subscriberId or batchDate is required." }, { status: 400 });

    const db = getDb();
    const rows = await db
      .select({
        id: mailingProofs.id,
        capturedAt: mailingProofs.capturedAt,
        uploadedBy: mailingProofs.uploadedBy,
        recipientName: mailings.recipientName,
        shipDate: mailings.scheduledDate,
        letterNumber: mailings.letterNumber,
        character: subscriptions.character,
        subscriberId: subscriptions.subscriberId,
      })
      .from(mailingProofs)
      .innerJoin(mailings, eq(mailingProofs.mailingId, mailings.id))
      .innerJoin(subscriptions, eq(mailings.subscriptionId, subscriptions.id))
      .where(subscriberId ? eq(subscriptions.subscriberId, subscriberId) : eq(mailings.scheduledDate, batchDate!))
      .orderBy(desc(mailingProofs.capturedAt))
      .limit(200);

    return Response.json({ proofs: rows.map((row) => ({ ...row, imageUrl: `/api/mailing-proof/${row.id}` })) });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not load mailing photos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let storedPath = "";
  try {
    const form = await request.formData();
    const mailingId = String(form.get("mailingId") || "").trim();
    const sourceRow = String(form.get("sourceRow") || "").trim();
    const photo = form.get("photo");
    if (!mailingId || !sourceRow) return Response.json({ error: "Mailing information is missing." }, { status: 400 });
    if (!(photo instanceof File) || !photo.size) return Response.json({ error: "Take a photo before completing this mailing." }, { status: 400 });
    if (photo.size > MAX_BYTES) return Response.json({ error: "That photo is too large. Please retake it at normal camera size." }, { status: 413 });
    if (!ALLOWED_TYPES.has(photo.type)) return Response.json({ error: "Please upload a photo from the phone camera." }, { status: 400 });

    const db = getDb();
    const matches = await db.select({ id: mailings.id }).from(mailings).where(and(eq(mailings.appMailingId, mailingId), eq(mailings.lastSourceRow, sourceRow))).limit(2);
    if (matches.length !== 1) return Response.json({ error: "Could not identify this mailing safely. Refresh and try again." }, { status: 409 });

    const storageKey = `${randomUUID()}${EXTENSIONS[photo.type] || ".img"}`;
    const directory = storageDirectory();
    await mkdir(directory, { recursive: true });
    storedPath = path.join(directory, storageKey);
    await writeFile(storedPath, Buffer.from(await photo.arrayBuffer()));

    let actorEmail = "no-session@test.invalid";
    try {
      const session = await auth();
      actorEmail = session?.user?.email ?? actorEmail;
    } catch (error) {
      const code = error && typeof error === "object" && "__NEXT_ERROR_CODE" in error ? (error as { __NEXT_ERROR_CODE: unknown }).__NEXT_ERROR_CODE : undefined;
      if (code !== "E251") throw error;
    }
    let proofId = 0;
    await db.transaction(async (tx) => {
      const [proof] = await tx.insert(mailingProofs).values({
        mailingId: matches[0].id,
        storageKey,
        originalName: photo.name || "camera-photo",
        contentType: photo.type,
        sizeBytes: photo.size,
        uploadedBy: actorEmail,
      }).returning({ id: mailingProofs.id });
      proofId = proof.id;
      const key = `${mailingId}::${sourceRow}`;
      const outcome = await writeMailingStatus(key, "Mailed", tx);
      if (outcome) await tx.insert(auditEvents).values({ actorEmail, kind: "mailingStatus", itemKey: key, previousValue: outcome.previousValue, newValue: outcome.newValue });
      await tx.insert(auditEvents).values({ actorEmail, kind: "mailingProof", itemKey: key, previousValue: null, newValue: `Photo ${proof.id}` });
    });

    return Response.json({ ok: true, proofId, imageUrl: `/api/mailing-proof/${proofId}`, marker: await currentChangeMarker(db) });
  } catch (error) {
    if (storedPath) await rm(storedPath, { force: true }).catch(() => {});
    console.error(error);
    return Response.json({ error: "Could not save the photo. The mailing was not completed." }, { status: 500 });
  }
}
