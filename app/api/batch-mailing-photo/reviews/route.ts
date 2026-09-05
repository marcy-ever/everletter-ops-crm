import { randomUUID } from "node:crypto";
import { link } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, mailingPhotoReviews, mailingProofs, mailings, subscriptions } from "@/db/schema";
import { writeMailingStatus } from "@/lib/write-to-tables";

function directory() { return process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs"); }

export async function GET() {
  const db = getDb();
  const reviews = await db.select({ id: mailingPhotoReviews.id, batchDate: mailingPhotoReviews.batchDate, extractedText: mailingPhotoReviews.extractedText, suggestedMailingId: mailingPhotoReviews.suggestedMailingId, createdAt: mailingPhotoReviews.createdAt, suggestedName: mailings.recipientName })
    .from(mailingPhotoReviews).leftJoin(mailings, eq(mailingPhotoReviews.suggestedMailingId, mailings.id)).where(eq(mailingPhotoReviews.status, "Pending")).orderBy(desc(mailingPhotoReviews.createdAt)).limit(100);
  const options = await db.select({ mailingId: mailings.id, recipientName: mailings.recipientName, shipDate: mailings.scheduledDate, character: subscriptions.character, letterNumber: mailings.letterNumber })
    .from(mailings).innerJoin(subscriptions, eq(mailings.subscriptionId, subscriptions.id)).where(and(ne(mailings.status, "Mailed"), eq(subscriptions.status, "Active"))).limit(500);
  return Response.json({ reviews: reviews.map((item) => ({ ...item, imageUrl: `/api/batch-mailing-photo/reviews/${item.id}` })), options });
}

export async function POST(request: Request) {
  try {
    const { reviewId, mailingId } = await request.json();
    const db = getDb();
    const [review] = await db.select().from(mailingPhotoReviews).where(and(eq(mailingPhotoReviews.id, Number(reviewId)), eq(mailingPhotoReviews.status, "Pending"))).limit(1);
    const [mailing] = await db.select().from(mailings).where(and(eq(mailings.id, String(mailingId)), ne(mailings.status, "Mailed"))).limit(1);
    if (!review || !mailing) return Response.json({ error: "That review item or mailing is no longer available." }, { status: 409 });
    const extension = path.extname(review.storageKey) || ".jpg";
    const proofKey = `${randomUUID()}${extension}`;
    await link(path.join(directory(), review.storageKey), path.join(directory(), proofKey));
    await db.transaction(async (tx) => {
      const [proof] = await tx.insert(mailingProofs).values({ mailingId: mailing.id, storageKey: proofKey, originalName: review.originalName, contentType: review.contentType, sizeBytes: review.sizeBytes, uploadedBy: review.uploadedBy }).returning({ id: mailingProofs.id });
      const key = `${mailing.appMailingId}::${mailing.lastSourceRow}`;
      const outcome = await writeMailingStatus(key, "Mailed", tx);
      if (outcome) await tx.insert(auditEvents).values({ actorEmail: review.uploadedBy, kind: "mailingStatus", itemKey: key, previousValue: outcome.previousValue, newValue: "Mailed" });
      await tx.insert(auditEvents).values({ actorEmail: review.uploadedBy, kind: "mailingProof", itemKey: key, previousValue: null, newValue: `Reviewed batch photo ${proof.id}` });
      await tx.update(mailingPhotoReviews).set({ status: "Resolved", suggestedMailingId: mailing.id, reviewedAt: new Date() }).where(eq(mailingPhotoReviews.id, review.id));
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not confirm this envelope." }, { status: 500 });
  }
}
