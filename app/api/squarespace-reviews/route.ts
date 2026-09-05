import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, squarespaceOrderReviews, subscribers } from "@/db/schema";
import type { SquarespacePreviewOrder } from "@/lib/domain/squarespace-preview";

export async function GET() {
  const db = getDb();
  const rows = await db.select({ id: squarespaceOrderReviews.id, order: squarespaceOrderReviews.snapshot, createdAt: squarespaceOrderReviews.createdAt })
    .from(squarespaceOrderReviews).where(eq(squarespaceOrderReviews.status, "Pending")).orderBy(desc(squarespaceOrderReviews.createdAt)).limit(100);
  const customerRows = await db.select({ id: subscribers.id, email: subscribers.email }).from(subscribers);
  const byEmail = new Map<string, string | null>();
  for (const customer of customerRows) {
    const email = customer.email.trim().toLowerCase();
    if (!email) continue;
    byEmail.set(email, byEmail.has(email) ? null : customer.id);
  }
  return Response.json({ reviews: rows.map((row) => {
    const order = row.order as SquarespacePreviewOrder;
    return { ...row, order: { ...order, subscriberId: byEmail.get(order.customerEmail.trim().toLowerCase()) || undefined } };
  }) });
}

export async function POST(request: Request) {
  try {
    const { order } = await request.json() as { order?: SquarespacePreviewOrder };
    if (!order?.id || !order.orderNumber || !Array.isArray(order.warnings)) return Response.json({ error: "That Squarespace order is incomplete." }, { status: 400 });
    let actorEmail = "no-session@test.invalid";
    try { actorEmail = (await auth())?.user?.email ?? actorEmail; } catch {}
    const db = getDb();
    const inserted = await db.transaction(async (tx) => {
      const rows = await tx.insert(squarespaceOrderReviews).values({ squarespaceOrderId: order.id, orderNumber: order.orderNumber, snapshot: order, stagedBy: actorEmail })
        .onConflictDoNothing({ target: squarespaceOrderReviews.squarespaceOrderId }).returning({ id: squarespaceOrderReviews.id });
      if (rows.length) await tx.insert(auditEvents).values({ actorEmail, kind: "squarespaceReview", itemKey: order.id, previousValue: null, newValue: `Order ${order.orderNumber} sent to Needs Review` });
      return rows[0];
    });
    if (!inserted) return Response.json({ error: "That order is already in Needs Review." }, { status: 409 });
    return Response.json({ ok: true, reviewId: inserted.id });
  } catch (error) {
    console.error("Could not stage Squarespace order", error);
    return Response.json({ error: "Could not send this order to Needs Review." }, { status: 500 });
  }
}
