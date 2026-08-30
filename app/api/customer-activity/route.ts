import { desc, eq, like, or } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents } from "@/db/schema/audit_events";
import { mailings } from "@/db/schema/mailings";
import { subscriptions } from "@/db/schema/subscriptions";

const MAX_EVENTS = 100;

export async function GET(request: Request) {
  try {
    const subscriberId = new URL(request.url).searchParams.get("subscriberId")?.trim();
    if (!subscriberId) {
      return Response.json({ error: "subscriberId is required." }, { status: 400 });
    }
    if (!/^SUB-[A-Z0-9]+$/.test(subscriberId)) {
      return Response.json({ error: "subscriberId is invalid." }, { status: 400 });
    }

    const db = getDb();
    const customerMailings = await db
      .select({ appMailingId: mailings.appMailingId, sourceRow: mailings.lastSourceRow })
      .from(mailings)
      .innerJoin(subscriptions, eq(mailings.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.subscriberId, subscriberId));

    const customerKeys = customerMailings
      .filter((mailing) => mailing.sourceRow)
      .map((mailing) => like(auditEvents.itemKey, `${mailing.appMailingId}::${mailing.sourceRow}%`));

    const events = await db
      .select()
      .from(auditEvents)
      .where(or(
        eq(auditEvents.kind, "crmDataset"),
        eq(auditEvents.itemKey, subscriberId),
        like(auditEvents.itemKey, `%::${subscriberId}::%`),
        ...customerKeys,
      ))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(MAX_EVENTS);

    return Response.json({ events });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not load customer activity." }, { status: 500 });
  }
}
