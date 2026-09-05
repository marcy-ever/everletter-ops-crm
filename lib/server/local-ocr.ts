import { createWorker } from "tesseract.js";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const localRequire = createRequire(import.meta.url);

export async function readEnvelopePhoto(buffer: Buffer): Promise<string> {
  const language = localRequire("@tesseract.js-data/eng");
  const cachePath = path.join(os.tmpdir(), "everletter-ocr-cache");
  mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker("eng", 1, { langPath: language.langPath, gzip: language.gzip, cachePath });
  try {
    const result = await worker.recognize(buffer);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}
