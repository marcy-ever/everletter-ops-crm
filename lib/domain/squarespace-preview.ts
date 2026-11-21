export interface SquarespacePreviewOrder {
  id: string; orderNumber: string; createdOn: string; customerName: string; customerEmail: string;
  shippingAddress: string; products: string[]; details: string[]; paymentState: string;
  addressLine1?: string; addressLine2?: string; city?: string; addressState?: string; postalCode?: string;
  billingAddress?: string; billingAddressLine1?: string; billingAddressLine2?: string;
  billingCity?: string; billingState?: string; billingPostalCode?: string; billingCountry?: string;
  fulfillmentStatus?: string; testMode?: boolean;
  giftMessage?: string;
  birthdayDate?: string;
  childFirstName?: string;
  preferredWoodlandCharacter?: string;
  northPolePersonalization?: string;
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
  childFirstName?: string;
  preferredWoodlandCharacter?: string;
  northPolePersonalization?: string;
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

function detailValue(details: string[], label: RegExp): string {
  const detail = details.find((item) => label.test(item.slice(0, Math.max(0, item.indexOf(":")))));
  return detail?.replace(/^[^:]*:\s*/, "").trim() || "";
}

export function normalizeNorthPolePreviewOrder(order: SquarespacePreviewOrder): SquarespacePreviewOrder {
  if (!/personalized christmas letter from the north pole/i.test(order.products.join(" "))) return order;
  const childFirstName = order.childFirstName?.trim() || detailValue(order.details, /child(?:'|’)?s first name|child first name/i);
  const preferredWoodlandCharacter = order.preferredWoodlandCharacter?.trim() || detailValue(order.details, /preferred woodland character/i);
  const northPolePersonalization = order.northPolePersonalization?.trim() || detailValue(order.details, /tell us something wonderful/i);
  const warnings = order.warnings.filter((warning) => !/^(character|plan) needs review$/i.test(warning));
  if (!childFirstName && !warnings.includes("Child's first name needs review")) warnings.push("Child's first name needs review");
  if (!preferredWoodlandCharacter && !warnings.includes("Preferred woodland character needs review")) warnings.push("Preferred woodland character needs review");
  return { ...order, character: "North Pole", plan: "One-time", childFirstName, preferredWoodlandCharacter, northPolePersonalization, warnings };
}
