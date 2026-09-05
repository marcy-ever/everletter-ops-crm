import { count, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { auditEvents, integrationSyncState, squarespaceOrderReviews } from "@/db/schema";
import type { SquarespacePreviewOrder } from "@/lib/domain/squarespace-preview";
import { GET as getSquarespacePreview } from "@/app/api/squarespace-preview/route";

const PROVIDER = "squarespace_orders";

export async function GET() {
  const db = getDb();
  const [states, pending] = await Promise.all([
    db.select().from(integrationSyncState).where(eq(integrationSyncState.provider, PROVIDER)).limit(1),
    db.select({ count: count() }).from(squarespaceOrderReviews).where(eq(squarespaceOrderReviews.status, "Pending")),
  ]);
  return Response.json({ lastCheckedAt: states[0]?.lastCheckedAt?.toISOString() ?? "", pendingReviewCount: pending[0]?.count ?? 0 });
}

export async function POST() {
  try {
    const previewResponse = await getSquarespacePreview();
    if (!previewResponse.ok) return previewResponse;
    const preview = await previewResponse.json() as { orders?: SquarespacePreviewOrder[] };
    const remoteOrders = preview.orders ?? [];
    let actorEmail = "no-session@test.invalid";
    try { actorEmail = (await auth())?.user?.email ?? actorEmail; } catch {}
    const result = await getDb().transaction(async (tx) => {
      const states = await tx.select().from(integrationSyncState).where(eq(integrationSyncState.provider, PROVIDER)).limit(1);
      if (!states.length) {
        const newest = remoteOrders.map((order) => new Date(order.createdOn)).filter((date) => !Number.isNaN(date.valueOf())).sort((a, b) => b.valueOf() - a.valueOf())[0] ?? new Date();
        await tx.insert(integrationSyncState).values({ provider: PROVIDER, baselineOrderCreatedAt: newest, lastCheckedAt: new Date() });
        return { initialized: true, staged: 0 };
      }
      const baseline = states[0].baselineOrderCreatedAt.valueOf();
      const eligible = remoteOrders.filter((order) => new Date(order.createdOn).valueOf() > baseline && !order.existing && !order.reviewStatus && order.paymentState === "PAID" && order.fulfillmentStatus !== "CANCELED" && !order.testMode);
      let staged = 0;
      for (const order of eligible) {
        const inserted = await tx.insert(squarespaceOrderReviews).values({ squarespaceOrderId: order.id, orderNumber: order.orderNumber, snapshot: order, stagedBy: actorEmail })
          .onConflictDoNothing({ target: squarespaceOrderReviews.squarespaceOrderId }).returning({ id: squarespaceOrderReviews.id });
        if (inserted.length) {
          staged += 1;
          await tx.insert(auditEvents).values({ actorEmail, kind: "squarespaceAutoReview", itemKey: order.id, previousValue: null, newValue: `Order ${order.orderNumber} automatically sent to Needs Review` });
        }
      }
      await tx.update(integrationSyncState).set({ lastCheckedAt: new Date() }).where(eq(integrationSyncState.provider, PROVIDER));
      return { initialized: false, staged };
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Could not automatically check Squarespace", error);
    return Response.json({ error: "Could not automatically check Squarespace." }, { status: 500 });
  }
}
