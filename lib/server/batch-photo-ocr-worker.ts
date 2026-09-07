import { randomUUID } from "node:crypto";
import { link, readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, mailingPhotoReviews, mailingProofs, mailings, subscriptions } from "@/db/schema";
import { matchEnvelopeNames, normalizedOcrText } from "@/lib/domain/photo-name-matching";
import { everletterTodayIso } from "@/lib/domain/mailing-rules";
import { readEnvelopePhoto } from "@/lib/server/local-ocr";
import { writeMailingStatus } from "@/lib/write-to-tables";

const PENDING_TEXT = "Reading names…";
const FAILED_TEXT = "Names could not be read automatically.";
let busy = false;
let started = false;

function directory() { return process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs"); }

async function processNextPhoto(readPhoto: (buffer: Buffer) => Promise<string> = readEnvelopePhoto, today = everletterTodayIso(new Date())): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const db = getDb();
    const [next] = await db.select().from(mailingPhotoReviews)
      .where(and(eq(mailingPhotoReviews.status, "Pending"), or(eq(mailingPhotoReviews.extractedText, PENDING_TEXT), eq(mailingPhotoReviews.extractedText, ""))))
      .orderBy(asc(mailingPhotoReviews.id)).limit(1);
    if (!next) return;

    const reviewRows = await db.select().from(mailingPhotoReviews)
      .where(and(eq(mailingPhotoReviews.status, "Pending"), eq(mailingPhotoReviews.storageKey, next.storageKey)))
      .orderBy(asc(mailingPhotoReviews.id));
    const candidates = await db.select({
      id: mailings.id, appMailingId: mailings.appMailingId, sourceRow: mailings.lastSourceRow,
      recipientName: mailings.recipientName, status: mailings.status, addressLine1: mailings.addressLine1,
      addressLine2: mailings.addressLine2, city: mailings.city, state: mailings.state, zip: mailings.zip,
    }).from(mailings).innerJoin(subscriptions, eq(mailings.subscriptionId, subscriptions.id))
      .where(eq(mailings.scheduledDate, next.batchDate));

    let extractedText = FAILED_TEXT;
    try { extractedText = await readPhoto(await readFile(path.join(directory(), next.storageKey))) || FAILED_TEXT; }
    catch (error) { console.error("Batch photo OCR failed", error); }

    const duplicateNames = new Set(candidates.filter((candidate, index) =>
      candidates.findIndex((other) => normalizedOcrText(other.recipientName) === normalizedOcrText(candidate.recipientName)) !== index,
    ).map((candidate) => normalizedOcrText(candidate.recipientName)));
    const matches = matchEnvelopeNames(extractedText, candidates.map((candidate) => ({
      ...candidate,
      address: [candidate.addressLine1, candidate.addressLine2, candidate.city, candidate.state, candidate.zip].filter(Boolean).join(" "),
    })));
    const clear = matches.filter((match) => match.confidence === "clear" && !duplicateNames.has(normalizedOcrText(match.recipientName)));
    const uncertain = matches.filter((match) => match.confidence === "review" || duplicateNames.has(normalizedOcrText(match.recipientName)));

    await db.transaction(async (tx) => {
      let rowIndex = 0;
      for (const match of clear.slice(0, reviewRows.length)) {
        const review = reviewRows[rowIndex++];
        const extension = path.extname(next.storageKey) || ".jpg";
        const proofKey = `${randomUUID()}${extension}`;
        await link(path.join(directory(), next.storageKey), path.join(directory(), proofKey));
        const [proof] = await tx.insert(mailingProofs).values({
          mailingId: match.id, storageKey: proofKey, originalName: review.originalName,
          contentType: review.contentType, sizeBytes: review.sizeBytes, uploadedBy: review.uploadedBy,
        }).returning({ id: mailingProofs.id });
        const candidate = candidates.find((item) => item.id === match.id)!;
        const key = `${candidate.appMailingId}::${candidate.sourceRow}`;
        if (next.batchDate <= today && candidate.status !== "Mailed") {
          const outcome = await writeMailingStatus(key, "Mailed", tx);
          if (outcome) await tx.insert(auditEvents).values({ actorEmail: review.uploadedBy, kind: "mailingStatus", itemKey: key, previousValue: outcome.previousValue, newValue: "Mailed" });
        }
        const proofLabel = next.batchDate > today ? "Prepared batch photo" : "Matched batch photo";
        await tx.insert(auditEvents).values({ actorEmail: review.uploadedBy, kind: "mailingProof", itemKey: key, previousValue: null, newValue: `${proofLabel} ${proof.id}` });
        await tx.update(mailingPhotoReviews).set({ status: "Resolved", extractedText, suggestedMailingId: match.id, reviewedAt: new Date() }).where(eq(mailingPhotoReviews.id, review.id));
      }
      for (const review of reviewRows.slice(rowIndex)) {
        const suggestion = uncertain.shift();
        await tx.update(mailingPhotoReviews).set({ extractedText, suggestedMailingId: suggestion?.id ?? null }).where(eq(mailingPhotoReviews.id, review.id));
      }
    });
  } catch (error) {
    console.error("Batch photo background worker failed", error);
  } finally {
    busy = false;
  }
}

export function startBatchPhotoOcrWorker(): void {
  if (started || !process.env.DATABASE_URL) return;
  started = true;
  const timer = setInterval(() => { void processNextPhoto(); }, 15_000);
  timer.unref();
  void processNextPhoto();
}

export { processNextPhoto };
