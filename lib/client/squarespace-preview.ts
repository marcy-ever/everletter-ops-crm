import type { SquarespaceImportInput, SquarespaceOrderReviewState, SquarespacePreviewOrder, SquarespacePreviewState } from "@/lib/domain/squarespace-preview";

export async function loadSquarespacePreview(): Promise<Omit<SquarespacePreviewState, "loading" | "failed" | "message">> {
  const [response, statusResponse] = await Promise.all([fetch("/api/squarespace-preview", { cache: "no-store" }), fetch("/api/squarespace-sync", { cache: "no-store" })]);
  const body = await response.json().catch(() => ({}));
  const status = await statusResponse.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not load Squarespace orders.");
  return { orders: body.orders ?? [], hasMore: Boolean(body.hasMore), lastCheckedAt: status.lastCheckedAt || "", pendingReviewCount: Number(status.pendingReviewCount || 0) };
}

export async function stageSquarespaceOrder(order: SquarespacePreviewOrder): Promise<void> {
  const response = await fetch("/api/squarespace-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not send this order to Needs Review.");
}

export async function loadSquarespaceReviews(): Promise<SquarespaceOrderReviewState["reviews"]> {
  const response = await fetch("/api/squarespace-reviews", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load Squarespace reviews.");
  return (await response.json()).reviews ?? [];
}

export async function syncNewSquarespaceOrders(): Promise<number> {
  const response = await fetch("/api/squarespace-sync", { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not check Squarespace.");
  return Number(body.staged || 0);
}

export async function importSquarespaceReview(reviewId: number, input: SquarespaceImportInput): Promise<void> {
  const response = await fetch("/api/squarespace-reviews/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId, input }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not import this order.");
}

export async function ignoreSquarespaceReview(reviewId: number): Promise<void> {
  const response = await fetch(`/api/squarespace-reviews/${reviewId}`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not ignore this order.");
}
