import { createWorker, type Worker } from "tesseract.js";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const localRequire = createRequire(import.meta.url);

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  const language = localRequire("@tesseract.js-data/eng");
  const cachePath = path.join(os.tmpdir(), "everletter-ocr-cache");
  mkdirSync(cachePath, { recursive: true });
  workerPromise = createWorker("eng", 1, { langPath: language.langPath, gzip: language.gzip, cachePath });
  return workerPromise;
}

export async function readEnvelopePhoto(buffer: Buffer): Promise<string> {
  const worker = await getWorker();
  const result = await worker.recognize(buffer);
  return result.data.text.trim();
}
