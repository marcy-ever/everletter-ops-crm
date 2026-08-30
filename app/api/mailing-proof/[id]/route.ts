import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailingProofs } from "@/db/schema";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const proofId = Number(id);
    if (!Number.isInteger(proofId) || proofId <= 0) return new Response("Not found", { status: 404 });
    const db = getDb();
    const [proof] = await db.select().from(mailingProofs).where(eq(mailingProofs.id, proofId)).limit(1);
    if (!proof) return new Response("Not found", { status: 404 });
    const directory = process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), "data", "mailing-proofs");
    const data = await readFile(path.join(directory, proof.storageKey));
    return new Response(data, { headers: { "Content-Type": proof.contentType, "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline" } });
  } catch (error) {
    console.error(error);
    return new Response("Could not load photo", { status: 500 });
  }
}
