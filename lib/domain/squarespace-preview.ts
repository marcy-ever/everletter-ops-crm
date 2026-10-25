export interface SquarespacePreviewOrder {
  id: string; orderNumber: string; createdOn: string; customerName: string; customerEmail: string;
  shippingAddress: string; products: string[]; details: string[]; paymentState: string;
  addressLine1?: string; addressLine2?: string; city?: string; addressState?: string; postalCode?: string;
  billingAddress?: string; billingAddressLine1?: string; billingAddressLine2?: string;
  billingCity?: string; billingState?: string; billingPostalCode?: string; billingCountry?: string;
  fulfillmentStatus?: string; testMode?: boolean;
  giftMessage?: string;
  birthdayDate?: string;
  recipientName: string; character: string; plan: string;
  existing: boolean; staged?: boolean; reviewStatus?: "Pending" | "Imported" | "Ignored"; warnings: string[];
  subscriberId?: string;
}

export interface SquarespaceImportInput {
  email: string; customerName: string; recipientName: string;
  addressLine1: string; addressLine2: string; city: string; addressState: string; postalCode: string;
  character: string; plan: string;
  giftMessage?: string;
  birthdayDate?: string;
}

export function normalizeBirthdayDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const candidate = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : "";
  if (!candidate) return "";
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== candidate ? "" : candidate;
}

export function birthdayPostcardMailDate(birthdayDate: unknown): string {
  const normalized = normalizeBirthdayDate(birthdayDate);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 10);
  return date.toISOString().slice(0, 10);
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
