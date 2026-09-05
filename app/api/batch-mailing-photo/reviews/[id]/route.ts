import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailingPhotoReviews } from "@/db/schema";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  const db = getDb();
  const [review] = await db.select().from(mailingPhotoReviews).where(eq(mailingPhotoReviews.id, id)).limit(1);
  if (!review) return new Response("Not found", { status: 404 });
  const directory = process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs");
  return new Response(await readFile(path.join(directory, review.storageKey)), { headers: { "Content-Type": review.contentType, "Cache-Control": "private, max-age=3600" } });
}
