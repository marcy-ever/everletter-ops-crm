import { randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, mailingPhotoReviews, mailingProofs, mailings, subscriptions } from "@/db/schema";
import { normalizedOcrText, matchEnvelopeNames } from "@/lib/domain/photo-name-matching";
import { readEnvelopePhoto } from "@/lib/server/local-ocr";
import { writeMailingStatus } from "@/lib/write-to-tables";

export const runtime = "nodejs";
export const maxDuration = 120;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSIONS: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const MAX_BYTES = 20 * 1024 * 1024;

function directory() { return process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs"); }

async function actor(): Promise<string> {
  try { return (await auth())?.user?.email ?? "no-session@test.invalid"; }
  catch (error) {
    const code = error && typeof error === "object" && "__NEXT_ERROR_CODE" in error ? (error as { __NEXT_ERROR_CODE: unknown }).__NEXT_ERROR_CODE : undefined;
    if (code !== "E251") throw error;
    return "no-session@test.invalid";
  }
}

export async function POST(request: Request) {
  let storedPath = "";
  try {
    const form = await request.formData();
    const batchDate = String(form.get("batchDate") || "");
    const expectedCount = Math.max(1, Math.min(30, Number(form.get("envelopeCount")) || 1));
    const photo = form.get("photo");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(batchDate)) return Response.json({ error: "Choose the mailing date for this photo." }, { status: 400 });
    if (!(photo instanceof File) || !photo.size) return Response.json({ error: "Choose a batch photo." }, { status: 400 });
    if (photo.size > MAX_BYTES) return Response.json({ error: "That batch photo is too large." }, { status: 413 });
    if (!ALLOWED_TYPES.has(photo.type)) return Response.json({ error: "Use a JPG, PNG, or WebP photo." }, { status: 400 });

    const buffer = Buffer.from(await photo.arrayBuffer());
    const storageKey = `${randomUUID()}${EXTENSIONS[photo.type]}`;
    await mkdir(directory(), { recursive: true });
    storedPath = path.join(directory(), storageKey);
    await writeFile(storedPath, buffer);
    const extractedText = await readEnvelopePhoto(buffer);
    const db = getDb();
    const candidates = await db.select({ id: mailings.id, appMailingId: mailings.appMailingId, sourceRow: mailings.lastSourceRow, recipientName: mailings.recipientName })
      .from(mailings).innerJoin(subscriptions, eq(mailings.subscriptionId, subscriptions.id))
      .where(and(eq(mailings.scheduledDate, batchDate), ne(mailings.status, "Mailed"), eq(subscriptions.status, "Active")));
    const matches = matchEnvelopeNames(extractedText, candidates);
    const duplicateNames = new Set(candidates.filter((candidate, index) => candidates.findIndex((other) => normalizedOcrText(other.recipientName) === normalizedOcrText(candidate.recipientName)) !== index).map((candidate) => normalizedOcrText(candidate.recipientName)));
    const clear = matches.filter((match) => match.confidence === "clear" && !duplicateNames.has(normalizedOcrText(match.recipientName)));
    const review = matches.filter((match) => match.confidence === "review" || duplicateNames.has(normalizedOcrText(match.recipientName)));
    const who = await actor();
    await db.transaction(async (tx) => {
      for (const match of clear) {
        const proofKey = `${randomUUID()}${EXTENSIONS[photo.type]}`;
        await link(storedPath, path.join(directory(), proofKey));
        const [proof] = await tx.insert(mailingProofs).values({ mailingId: match.id, storageKey: proofKey, originalName: photo.name, contentType: photo.type, sizeBytes: photo.size, uploadedBy: who }).returning({ id: mailingProofs.id });
        const candidate = candidates.find((item) => item.id === match.id)!;
        const key = `${candidate.appMailingId}::${candidate.sourceRow}`;
        const outcome = await writeMailingStatus(key, "Mailed", tx);
        if (outcome) await tx.insert(auditEvents).values({ actorEmail: who, kind: "mailingStatus", itemKey: key, previousValue: outcome.previousValue, newValue: "Mailed" });
        await tx.insert(auditEvents).values({ actorEmail: who, kind: "mailingProof", itemKey: key, previousValue: null, newValue: `Batch photo ${proof.id}` });
      }
      for (const match of review) await tx.insert(mailingPhotoReviews).values({ storageKey, originalName: photo.name, contentType: photo.type, sizeBytes: photo.size, batchDate, extractedText, suggestedMailingId: match.id, uploadedBy: who });
      const unresolvedCount = Math.max(0, expectedCount - clear.length - review.length);
      for (let index = 0; index < unresolvedCount; index += 1) await tx.insert(mailingPhotoReviews).values({ storageKey, originalName: photo.name, contentType: photo.type, sizeBytes: photo.size, batchDate, extractedText, suggestedMailingId: null, uploadedBy: who });
    });
    return Response.json({ ok: true, matched: clear.length, needsReview: Math.max(review.length, expectedCount - clear.length) });
  } catch (error) {
    if (storedPath) await rm(storedPath, { force: true }).catch(() => {});
    console.error(error);
    return Response.json({ error: "Could not process this batch photo." }, { status: 500 });
  }
}
