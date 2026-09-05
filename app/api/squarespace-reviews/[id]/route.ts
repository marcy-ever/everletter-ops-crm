import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, squarespaceOrderReviews } from "@/db/schema";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) return Response.json({ error: "Invalid order review." }, { status: 400 });
  let actorEmail = "no-session@test.invalid";
  try { actorEmail = (await auth())?.user?.email ?? actorEmail; } catch {}
  const result = await getDb().transaction(async (tx) => {
    const updated = await tx.update(squarespaceOrderReviews).set({ status: "Ignored", reviewedAt: new Date() })
      .where(and(eq(squarespaceOrderReviews.id, reviewId), eq(squarespaceOrderReviews.status, "Pending")))
      .returning({ orderNumber: squarespaceOrderReviews.orderNumber, squarespaceOrderId: squarespaceOrderReviews.squarespaceOrderId });
    if (!updated.length) return null;
    await tx.insert(auditEvents).values({ actorEmail, kind: "squarespaceIgnored", itemKey: updated[0].squarespaceOrderId, previousValue: "Pending review", newValue: `Order ${updated[0].orderNumber} ignored` });
    return updated[0];
  });
  if (!result) return Response.json({ error: "That order is no longer waiting for review." }, { status: 409 });
  return Response.json({ ok: true });
}
