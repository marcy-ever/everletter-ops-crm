import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { orders as storedOrders, squarespaceOrderReviews, subscriptions } from "@/db/schema";
import type { SquarespacePreviewOrder } from "@/lib/domain/squarespace-preview";
import { normalizeCharacter } from "@/lib/domain/characters";
import { normalizePlan } from "@/lib/domain/plans";

interface Address { firstName?: string; lastName?: string; address1?: string; address2?: string; city?: string; state?: string; postalCode?: string; countryCode?: string }
interface LabelValue { label?: string; optionName?: string; value?: unknown }
interface LineItem { productName?: string; quantity?: number; variantOptions?: LabelValue[]; customizations?: LabelValue[] }
interface RemoteOrder { id?: string; orderNumber?: string; createdOn?: string; customerEmail?: string; paymentState?: string; fulfillmentStatus?: string; testmode?: boolean; shippingAddress?: Address; billingAddress?: Address; formSubmission?: LabelValue[]; lineItems?: LineItem[] }

function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  return "";
}

function addressText(address?: Address): string {
  if (!address) return "";
  return [address.address1, address.address2, [address.city, address.state, address.postalCode].filter(Boolean).join(", "), address.countryCode].filter(Boolean).join(" · ");
}

export async function GET() {
  const token = process.env.SQUARESPACE_API_KEY;
  if (!token) return Response.json({ error: "Squarespace is not connected yet." }, { status: 503 });
  try {
    const response = await fetch("https://api.squarespace.com/1.0/commerce/orders", { headers: { Authorization: `Bearer ${token}`, "User-Agent": "Everletter Ops CRM" }, cache: "no-store" });
    if (!response.ok) return Response.json({ error: "Squarespace rejected the connection. Please check the API key." }, { status: 502 });
    const body = await response.json() as { result?: RemoteOrder[]; pagination?: { hasNextPage?: boolean } };
    const remote = Array.isArray(body.result) ? body.result : [];
    const numbers = remote.map((order) => String(order.orderNumber || "")).filter(Boolean);
    const existingRows = numbers.length ? await getDb().select({ number: storedOrders.externalOrderNumber, subscriberId: subscriptions.subscriberId }).from(storedOrders).innerJoin(subscriptions, eq(storedOrders.subscriptionId, subscriptions.id)).where(inArray(storedOrders.externalOrderNumber, numbers)) : [];
    const existing = new Map(existingRows.map((row) => [row.number, row.subscriberId]));
    const remoteIds = remote.map((order) => String(order.id || "")).filter(Boolean);
    const reviewRows = remoteIds.length ? await getDb().select({ id: squarespaceOrderReviews.squarespaceOrderId, status: squarespaceOrderReviews.status }).from(squarespaceOrderReviews).where(inArray(squarespaceOrderReviews.squarespaceOrderId, remoteIds)) : [];
    const reviewStatus = new Map(reviewRows.map((row) => [row.id, row.status as "Pending" | "Imported" | "Ignored"]));
    const orders: SquarespacePreviewOrder[] = remote.map((order) => {
      const address = order.shippingAddress || order.billingAddress;
      const customerName = [address?.firstName, address?.lastName].filter(Boolean).join(" ").trim();
      const products = (order.lineItems || []).map((item) => `${item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ""}${item.productName || "Unnamed item"}`);
      const selections = [...(order.formSubmission || []), ...(order.lineItems || []).flatMap((item) => [...(item.variantOptions || []), ...(item.customizations || [])])];
      const details = selections.map((item) => `${item.label || item.optionName || "Detail"}: ${displayValue(item.value)}`).filter((item) => !item.endsWith(": "));
      const selectedCharacter = selections.find((item) => `${item.label || item.optionName || ""}`.toLowerCase().includes("character"));
      const selectedPlan = selections.find((item) => `${item.label || item.optionName || ""}`.toLowerCase().includes("plan"));
      const selectedRecipient = selections.find((item) => /recipient name|^name$/i.test(`${item.label || item.optionName || ""}`.trim()));
      const character = normalizeCharacter(displayValue(selectedCharacter?.value) || products.join(" "));
      const plan = normalizePlan(displayValue(selectedPlan?.value) || products.join(" "));
      const recipientName = displayValue(selectedRecipient?.value);
      const warnings: string[] = [];
      if (!order.customerEmail) warnings.push("Missing email");
      if (!customerName) warnings.push("Missing customer name");
      if (!addressText(address)) warnings.push("Missing mailing address");
      if (!products.length) warnings.push("No products found");
      if (character === "Needs Review" || !["Marley", "Old Marley", "Ringo", "Oliver", "Harper", "Penelope", "Marigold", "Seraphine", "Legends"].includes(character)) warnings.push("Character needs review");
      if (!["Month-to-month", "6-month", "12-month", "One-time"].includes(plan)) warnings.push("Plan needs review");
      if (!recipientName) warnings.push("Recipient name needs review");
      if (order.paymentState !== "PAID") warnings.push(`Payment is ${order.paymentState || "unknown"}`);
      if (order.fulfillmentStatus === "CANCELED") warnings.push("Order is canceled");
      if (order.testmode) warnings.push("Test order");
      const id = String(order.id || order.orderNumber || "");
      const orderNumber = String(order.orderNumber || "Unknown");
      const status = reviewStatus.get(id);
      return { id, orderNumber, createdOn: String(order.createdOn || ""), customerName: customerName || "Missing name", customerEmail: String(order.customerEmail || ""), shippingAddress: addressText(address), addressLine1: address?.address1 || "", addressLine2: address?.address2 || "", city: address?.city || "", addressState: address?.state || "", postalCode: address?.postalCode || "", fulfillmentStatus: order.fulfillmentStatus || "", testMode: Boolean(order.testmode), products, details, paymentState: String(order.paymentState || "Unknown"), recipientName, character, plan, existing: existing.has(orderNumber), subscriberId: existing.get(orderNumber), staged: status === "Pending", reviewStatus: status, warnings };
    });
    return Response.json({ orders, hasMore: Boolean(body.pagination?.hasNextPage) });
  } catch (error) {
    console.error("Squarespace preview failed", error);
    return Response.json({ error: "Could not reach Squarespace." }, { status: 502 });
  }
}
