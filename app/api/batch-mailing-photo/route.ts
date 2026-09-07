import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { mailingPhotoReviews } from "@/db/schema";

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
    // Save immediately so the phone request never waits on OCR. The
    // background worker reads names, attaches clear matches, and leaves
    // only uncertain envelopes in Needs Review.
    const extractedText = "Reading names…";
    const db = getDb();
    const who = await actor();
    await db.transaction(async (tx) => {
      for (let index = 0; index < expectedCount; index += 1) await tx.insert(mailingPhotoReviews).values({ storageKey, originalName: photo.name, contentType: photo.type, sizeBytes: photo.size, batchDate, extractedText, suggestedMailingId: null, uploadedBy: who });
    });
    return Response.json({ ok: true, matched: 0, needsReview: expectedCount });
  } catch (error) {
    if (storedPath) await rm(storedPath, { force: true }).catch(() => {});
    console.error(error);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EACCES") {
      return Response.json({ error: "The server photo folder is not writable. Please contact support." }, { status: 500 });
    }
    return Response.json({ error: "Could not process this batch photo." }, { status: 500 });
  }
}
