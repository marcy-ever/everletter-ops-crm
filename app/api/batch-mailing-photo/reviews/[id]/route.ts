import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, mailingPhotoReviews } from "@/db/schema";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  const db = getDb();
  const [review] = await db.select().from(mailingPhotoReviews).where(eq(mailingPhotoReviews.id, id)).limit(1);
  if (!review) return new Response("Not found", { status: 404 });
  const directory = process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs");
  return new Response(await readFile(path.join(directory, review.storageKey)), { headers: { "Content-Type": review.contentType, "Cache-Control": "private, max-age=3600" } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "Invalid photo review." }, { status: 400 });

  const db = getDb();
  const [review] = await db.select().from(mailingPhotoReviews).where(eq(mailingPhotoReviews.id, id)).limit(1);
  if (!review) return Response.json({ error: "Photo not found." }, { status: 404 });

  let actorEmail = review.uploadedBy;
  try { actorEmail = (await auth())?.user?.email ?? actorEmail; } catch {}

  const deleted = await db.transaction(async (tx) => {
    const rows = await tx.delete(mailingPhotoReviews).where(eq(mailingPhotoReviews.storageKey, review.storageKey)).returning({ id: mailingPhotoReviews.id });
    await tx.insert(auditEvents).values({
      actorEmail,
      kind: "batchPhotoDeleted",
      itemKey: `batch-photo:${review.storageKey}`,
      previousValue: `${rows.length} review item(s)`,
      newValue: "Uploaded batch photo deleted",
    });
    return rows.length;
  });

  const directory = process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs");
  await rm(path.join(directory, review.storageKey), { force: true });
  return Response.json({ ok: true, deleted });
}
