import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, ingestionEvents, mailings, orders, squarespaceOrderReviews, subscribers, subscriptions } from "@/db/schema";
import { batchDatesForOrder } from "@/lib/domain/batch-dates";
import { buildMailingId, buildRecipientId, buildSubscriberId, buildSubscriptionId } from "@/lib/domain/ids";
import { plannedLetterCount } from "@/lib/domain/plans";
import type { SquarespaceImportInput } from "@/lib/domain/squarespace-preview";

const CHARACTERS = new Set(["Marley", "Old Marley", "Ringo", "Oliver", "Harper", "Penelope", "Marigold", "Seraphine", "Legends"]);
const PLANS = new Set(["Month-to-month", "6-month", "12-month", "One-time"]);

export async function POST(request: Request) {
  try {
    const { reviewId, input } = await request.json() as { reviewId?: number; input?: SquarespaceImportInput };
    if (!Number.isInteger(reviewId) || !input) return Response.json({ error: "That order review is incomplete." }, { status: 400 });
    const email = input.email.trim().toLowerCase();
    const required = [email, input.customerName, input.recipientName, input.addressLine1];
    if (required.some((value) => !String(value || "").trim()) || !CHARACTERS.has(input.character) || !PLANS.has(input.plan)) return Response.json({ error: "Complete the customer, recipient, address, character, and plan first." }, { status: 400 });
    let actorEmail = "no-session@test.invalid";
    try { actorEmail = (await auth())?.user?.email ?? actorEmail; } catch {}
    const result = await getDb().transaction(async (tx) => {
      const reviewRows = await tx.select().from(squarespaceOrderReviews).where(and(eq(squarespaceOrderReviews.id, reviewId!), eq(squarespaceOrderReviews.status, "Pending"))).limit(1);
      const review = reviewRows[0];
      if (!review) throw new ImportError(409, "That order was already imported or is no longer pending.");
      const remote = review.snapshot;
      if (remote.paymentState !== "PAID" || remote.fulfillmentStatus === "CANCELED" || remote.testMode || remote.warnings.some((warning) => /payment is|canceled|test order/i.test(warning))) throw new ImportError(400, "Canceled, unpaid, and test orders cannot be imported.");
      if (!/^\d{4}-\d{2}-\d{2}/.test(remote.createdOn) || Number.isNaN(new Date(remote.createdOn).valueOf())) throw new ImportError(400, "This order needs a valid order date before it can be imported.");
      const duplicateOrder = await tx.select({ id: orders.id }).from(orders).where(eq(orders.externalOrderNumber, remote.orderNumber)).limit(1);
      if (duplicateOrder.length) throw new ImportError(409, "That Squarespace order is already in Everletter.");

      const subscriberMatches = await tx.select().from(subscribers).where(sql`lower(${subscribers.email}) = ${email}`).limit(2);
      if (subscriberMatches.length > 1) throw new ImportError(409, "More than one customer has this email. Please resolve the duplicate first.");
      let subscriber = subscriberMatches[0];
      if (!subscriber) {
        const subscriberId = buildSubscriberId({ email, recipientName: input.recipientName, address: input.addressLine1 });
        [subscriber] = await tx.insert(subscribers).values({ id: subscriberId, email, name: input.customerName.trim() }).returning();
      } else if (subscriber.name !== input.customerName.trim()) {
        [subscriber] = await tx.update(subscribers).set({ name: input.customerName.trim() }).where(eq(subscribers.id, subscriber.id)).returning();
      }

      const subscriptionMatches = await tx.select().from(subscriptions).where(and(eq(subscriptions.subscriberId, subscriber.id), sql`lower(${subscriptions.recipientName}) = ${input.recipientName.trim().toLowerCase()}`, sql`lower(${subscriptions.character}) = ${input.character.toLowerCase()}`)).limit(2);
      if (subscriptionMatches.length > 1) throw new ImportError(409, "This customer has duplicate matching subscriptions. Please resolve them first.");
      const count = plannedLetterCount(input.plan);
      const address = [input.addressLine1, input.addressLine2, input.city, input.addressState, input.postalCode].filter(Boolean).join(" ");
      const recipientId = buildRecipientId({ subscriberId: subscriber.id, recipientName: input.recipientName, address });
      let subscription = subscriptionMatches[0];
      let firstLetter = 1;
      if (subscription) {
        const existingMailings = await tx.select({ letterNumber: mailings.letterNumber }).from(mailings).where(eq(mailings.subscriptionId, subscription.id));
        firstLetter = Math.max(0, ...existingMailings.map((row) => row.letterNumber || 0)) + 1;
        [subscription] = await tx.update(subscriptions).set({ status: "Active", termType: input.plan, totalLettersExpected: Math.max(subscription.totalLettersExpected, firstLetter - 1) + count, recipientName: input.recipientName.trim(), addressLine1: input.addressLine1.trim(), addressLine2: input.addressLine2.trim() || null, city: input.city.trim() || null, state: input.addressState.trim() || null, zip: input.postalCode.trim() || null }).where(eq(subscriptions.id, subscription.id)).returning();
      } else {
        const subscriptionId = buildSubscriptionId({ recipientId, character: input.character, plan: input.plan });
        [subscription] = await tx.insert(subscriptions).values({ id: subscriptionId, subscriberId: subscriber.id, character: input.character, termType: input.plan, status: "Active", startedAt: remote.createdOn ? new Date(remote.createdOn) : null, totalLettersExpected: count, recipientName: input.recipientName.trim(), addressLine1: input.addressLine1.trim(), addressLine2: input.addressLine2.trim() || null, city: input.city.trim() || null, state: input.addressState.trim() || null, zip: input.postalCode.trim() || null }).returning();
      }
      const orderId = `SQ-${remote.id}`;
      await tx.insert(orders).values({ id: orderId, subscriptionId: subscription.id, externalOrderNumber: remote.orderNumber, orderedAt: remote.createdOn ? new Date(remote.createdOn) : null });
      const dates = batchDatesForOrder(remote.createdOn.slice(0, 10), count);
      for (let index = 0; index < count; index += 1) {
        const letterNumber = firstLetter + index;
        const sourceRow = String(1_000_000_000 + review.id * 100 + index);
        await tx.insert(mailings).values({ id: `${orderId}::${input.character}::${letterNumber}`, subscriptionId: subscription.id, appMailingId: buildMailingId({ orderId, recipientId, character: input.character, letterNumber, sourceRow }), lastSourceRow: sourceRow, letterNumber, scheduledDate: dates[index], status: "To Prepare", active: true, notes: `Imported from Squarespace order #${remote.orderNumber}`, recipientName: input.recipientName.trim(), addressLine1: input.addressLine1.trim(), addressLine2: input.addressLine2.trim() || null, city: input.city.trim() || null, state: input.addressState.trim() || null, zip: input.postalCode.trim() || null });
      }
      await tx.update(squarespaceOrderReviews).set({ status: "Imported", reviewedAt: new Date() }).where(eq(squarespaceOrderReviews.id, review.id));
      await tx.insert(ingestionEvents).values({ source: "squarespace_sync", rawPayload: { order: remote, corrections: input }, status: "success", summary: `Imported Squarespace order ${remote.orderNumber}: ${count} mailing(s)` });
      await tx.insert(auditEvents).values({ actorEmail, kind: "squarespaceImport", itemKey: remote.id, previousValue: "Pending review", newValue: `${subscriber.id}; ${subscription.id}; ${count} mailing(s)` });
      return { subscriberId: subscriber.id, mailingCount: count };
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ImportError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Could not import Squarespace order", error);
    return Response.json({ error: "Could not import this Squarespace order." }, { status: 500 });
  }
}

class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
