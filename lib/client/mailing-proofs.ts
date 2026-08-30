import type { MailingLike } from "@/lib/domain/keys";

export interface MailingProof {
  id: number;
  capturedAt: string;
  uploadedBy: string | null;
  recipientName: string;
  shipDate: string;
  letterNumber: number | null;
  character: string;
  subscriberId: string;
  imageUrl: string;
}

export interface MailingProofListState {
  loading: boolean;
  failed: boolean;
  proofs: MailingProof[];
}

export interface MailingProofUploadState { busy: boolean; error: string; }

export async function loadMailingProofs(filter: { subscriberId?: string; batchDate?: string }): Promise<MailingProof[]> {
  const params = new URLSearchParams();
  if (filter.subscriberId) params.set("subscriberId", filter.subscriberId);
  if (filter.batchDate) params.set("batchDate", filter.batchDate);
  const response = await fetch(`/api/mailing-proof?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load mailing photos.");
  const body = await response.json() as { proofs?: MailingProof[] };
  return Array.isArray(body.proofs) ? body.proofs : [];
}

export async function uploadMailingProof(mailing: MailingLike, photo: File): Promise<number | null> {
  const form = new FormData();
  form.set("mailingId", mailing.mailingId);
  form.set("sourceRow", String(mailing.sourceRow));
  form.set("photo", photo, photo.name);
  const response = await fetch("/api/mailing-proof", { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Could not save the photo.");
  }
  const body = await response.json() as { marker?: number | null };
  return typeof body.marker === "number" || body.marker === null ? body.marker : null;
}
