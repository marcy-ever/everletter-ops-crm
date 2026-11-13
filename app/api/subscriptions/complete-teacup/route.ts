import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, mailings, orders, subscriptions } from "@/db/schema";
import { batchDatesForOrder } from "@/lib/domain/batch-dates";
import { buildMailingId, buildRecipientId } from "@/lib/domain/ids";

export async function POST(request: Request) {
  try {
    const { subscriptionId } = await request.json() as { subscriptionId?: string };
    if (!subscriptionId) return Response.json({ error: "Subscription is required." }, { status: 400 });
    let actorEmail = "no-session@test.invalid";
    try { actorEmail = (await auth())?.user?.email ?? actorEmail; } catch {}
    const result = await getDb().transaction(async (tx) => {
      const [subscription] = await tx.select().from(subscriptions).where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.character, "Teacup Series"))).limit(1);
      if (!subscription) throw new RepairError(404, "Teacup subscription not found.");
      const [order] = await tx.select().from(orders).where(eq(orders.subscriptionId, subscription.id)).limit(1);
      if (!order?.orderedAt) throw new RepairError(400, "This Teacup order has no original order date.");
      const existing = await tx.select().from(mailings).where(eq(mailings.subscriptionId, subscription.id));
      const orderDate = order.orderedAt.toISOString().slice(0, 10);
      const dates = batchDatesForOrder(orderDate, 6);
      const address = [subscription.addressLine1, subscription.addressLine2, subscription.city, subscription.state, subscription.zip].filter(Boolean).join(" ");
      const recipientId = buildRecipientId({ subscriberId: subscription.subscriberId, recipientName: subscription.recipientName, address });
      let inserted = 0;
      for (let letterNumber = 1; letterNumber <= 6; letterNumber += 1) {
        if (existing.some((row) => row.letterNumber === letterNumber)) continue;
        const sourceRow = `teacup-repair-${order.externalOrderNumber}-${letterNumber}`;
        await tx.insert(mailings).values({
          id: `${order.id}::Teacup Series::${letterNumber}`,
          subscriptionId: subscription.id,
          appMailingId: buildMailingId({ orderId: order.id, recipientId, character: "Teacup Series", letterNumber, sourceRow }),
          lastSourceRow: sourceRow,
          letterNumber,
          scheduledDate: dates[letterNumber - 1],
          status: "To Prepare",
          active: true,
          notes: `Completed Teacup Series schedule for Squarespace order #${order.externalOrderNumber}`,
          recipientName: subscription.recipientName,
          addressLine1: subscription.addressLine1,
          addressLine2: subscription.addressLine2,
          city: subscription.city,
          state: subscription.state,
          zip: subscription.zip,
        });
        inserted += 1;
      }
      await tx.update(subscriptions).set({ totalLettersExpected: 6 }).where(eq(subscriptions.id, subscription.id));
      await tx.insert(auditEvents).values({ actorEmail, kind: "teacupScheduleRepair", itemKey: subscription.id, previousValue: `${existing.length} mailing(s)`, newValue: "6 mailing(s)" });
      return { inserted };
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof RepairError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Could not complete Teacup schedule", error);
    return Response.json({ error: "Could not complete this Teacup schedule." }, { status: 500 });
  }
}

class RepairError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
