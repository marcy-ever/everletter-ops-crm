import { asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, subscribers, subscriptions } from "@/db/schema";

function address(parts: Array<string | null>): string {
  return parts.filter(Boolean).join(" · ");
}

export async function GET() {
  const rows = await getDb().select({
    subscriberId: subscribers.id,
    buyerName: subscribers.name,
    email: subscribers.email,
    orderNumber: orders.externalOrderNumber,
    orderedAt: orders.orderedAt,
    billingAddressLine1: orders.billingAddressLine1,
    billingAddressLine2: orders.billingAddressLine2,
    billingCity: orders.billingCity,
    billingState: orders.billingState,
    billingZip: orders.billingZip,
    billingCountry: orders.billingCountry,
    recipientName: subscriptions.recipientName,
    mailingAddressLine1: subscriptions.addressLine1,
    mailingAddressLine2: subscriptions.addressLine2,
    mailingCity: subscriptions.city,
    mailingState: subscriptions.state,
    mailingZip: subscriptions.zip,
    character: subscriptions.character,
  }).from(orders)
    .innerJoin(subscriptions, eq(orders.subscriptionId, subscriptions.id))
    .innerJoin(subscribers, eq(subscriptions.subscriberId, subscribers.id))
    .where(isNotNull(orders.billingAddressLine1))
    .orderBy(asc(subscribers.name), asc(orders.orderedAt));

  return Response.json({ rows: rows.map((row) => ({
    subscriberId: row.subscriberId,
    buyerName: row.buyerName,
    email: row.email,
    orderNumber: row.orderNumber,
    orderedAt: row.orderedAt?.toISOString() ?? "",
    billingAddress: address([row.billingAddressLine1, row.billingAddressLine2, [row.billingCity, row.billingState, row.billingZip].filter(Boolean).join(", "), row.billingCountry]),
    recipientName: row.recipientName,
    mailingAddress: address([row.mailingAddressLine1, row.mailingAddressLine2, [row.mailingCity, row.mailingState, row.mailingZip].filter(Boolean).join(", ")]),
    character: row.character,
  })) });
}
