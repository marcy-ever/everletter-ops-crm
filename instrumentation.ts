export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./instrumentation-server");
  const { startBatchPhotoOcrWorker } = await import("@/lib/server/batch-photo-ocr-worker");
  startBatchPhotoOcrWorker();
}
