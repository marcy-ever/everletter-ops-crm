export interface BatchPhotoResult { matched: number; needsReview: number }
export interface BatchPhotoReview { id: number; batchDate: string; extractedText: string; suggestedMailingId: string | null; suggestedName: string | null; imageUrl: string }
export interface BatchPhotoMailingOption { mailingId: string; recipientName: string; shipDate: string; character: string; letterNumber: string }
export interface BatchPhotoReviewState { loading: boolean; failed: boolean; reviews: BatchPhotoReview[]; options: BatchPhotoMailingOption[] }

export async function uploadBatchMailingPhoto(batchDate: string, envelopeCount: number, photo: File): Promise<BatchPhotoResult> {
  const form = new FormData();
  form.set("batchDate", batchDate);
  form.set("envelopeCount", String(envelopeCount));
  form.set("photo", photo);
  const response = await fetch("/api/batch-mailing-photo", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not process the batch photo.");
  return body;
}

export async function loadBatchPhotoReviews(): Promise<Pick<BatchPhotoReviewState, "reviews" | "options">> {
  const response = await fetch("/api/batch-mailing-photo/reviews");
  if (!response.ok) throw new Error("Could not load batch-photo reviews.");
  return response.json();
}

export async function confirmBatchPhotoReview(reviewId: number, mailingId: string): Promise<void> {
  const response = await fetch("/api/batch-mailing-photo/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId, mailingId }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not confirm this envelope.");
}
