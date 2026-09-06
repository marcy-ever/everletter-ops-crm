export interface SquarespacePreviewOrder {
  id: string; orderNumber: string; createdOn: string; customerName: string; customerEmail: string;
  shippingAddress: string; products: string[]; details: string[]; paymentState: string;
  addressLine1?: string; addressLine2?: string; city?: string; addressState?: string; postalCode?: string;
  fulfillmentStatus?: string; testMode?: boolean;
  giftMessage?: string;
  recipientName: string; character: string; plan: string;
  existing: boolean; staged?: boolean; reviewStatus?: "Pending" | "Imported" | "Ignored"; warnings: string[];
  subscriberId?: string;
}

export interface SquarespaceImportInput {
  email: string; customerName: string; recipientName: string;
  addressLine1: string; addressLine2: string; city: string; addressState: string; postalCode: string;
  character: string; plan: string;
  giftMessage?: string;
}

export interface SquarespacePreviewState {
  loading: boolean; failed: boolean; message: string; orders: SquarespacePreviewOrder[]; hasMore: boolean;
  lastCheckedAt?: string; pendingReviewCount?: number;
}

export interface SquarespaceOrderReviewState {
  loading: boolean; failed: boolean; message: string;
  reviews: Array<{ id: number; order: SquarespacePreviewOrder; createdAt: string }>;
}

export function giftMessageForOrder(order: Pick<SquarespacePreviewOrder, "giftMessage" | "details">): string {
  if (order.giftMessage?.trim()) return order.giftMessage.trim();
  const detail = order.details.find((item) => /^gift message|^special instructions?/i.test(item.trim()));
  return detail?.replace(/^[^:]*:\s*/, "").trim() || "";
}
