import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { fulfillmentControls, fulfillmentExports, mailings } from "@/db/schema";
import {
  FULFILLMENT_OWNERS,
  FULFILLMENT_STATUSES,
  LATE_ADDENDUM_STATUSES,
  type FulfillmentControl,
} from "@/lib/domain/fulfillment";

export const runtime = "nodejs";

async function actorEmail(): Promise<string> {
  try { return (await auth())?.user?.email || "no-session@test.invalid"; }
  catch (error) {
    const code = error && typeof error === "object" && "__NEXT_ERROR_CODE" in error ? (error as { __NEXT_ERROR_CODE: unknown }).__NEXT_ERROR_CODE : undefined;
    if (code === "E251") return "no-session@test.invalid";
    throw error;
  }
}

async function resolveMailing(db: ReturnType<typeof getDb>, appMailingId: string, sourceRow: string) {
  const matches = await db.select({ id: mailings.id }).from(mailings)
    .where(and(eq(mailings.appMailingId, appMailingId), eq(mailings.lastSourceRow, sourceRow))).limit(2);
  return matches.length === 1 ? matches[0] : null;
}

export async function GET(request: Request) {
  try {
    const batchDate = new URL(request.url).searchParams.get("batchDate")?.trim();
    if (!batchDate) return Response.json({ error: "batchDate is required." }, { status: 400 });
    const db = getDb();
    const controls = await db.select({
      appMailingId: mailings.appMailingId,
      sourceRow: mailings.lastSourceRow,
      owner: fulfillmentControls.owner,
      excludeFromPrinter: fulfillmentControls.excludeFromPrinter,
      paymentCleared: fulfillmentControls.paymentCleared,
      mailingEligible: fulfillmentControls.mailingEligible,
      lateAddendumStatus: fulfillmentControls.lateAddendumStatus,
      fulfillmentStatus: fulfillmentControls.fulfillmentStatus,
      qcInitials: fulfillmentControls.qcInitials,
      exportedDate: fulfillmentControls.exportedDate,
      batchName: fulfillmentControls.batchName,
    }).from(fulfillmentControls).innerJoin(mailings, eq(fulfillmentControls.mailingId, mailings.id)).where(eq(mailings.scheduledDate, batchDate));
    const history = await db.select({
      id: fulfillmentExports.id,
      batchDate: fulfillmentExports.batchDate,
      batchName: fulfillmentExports.batchName,
      exportKind: fulfillmentExports.exportKind,
      designGroup: fulfillmentExports.designGroup,
      rowCount: fulfillmentExports.rowCount,
      exportedAt: fulfillmentExports.exportedAt,
      exportedBy: fulfillmentExports.exportedBy,
    }).from(fulfillmentExports).where(eq(fulfillmentExports.batchDate, batchDate)).orderBy(desc(fulfillmentExports.exportedAt));
    return Response.json({
      controls: controls.map((row) => ({ ...row, sourceRow: row.sourceRow || "", exportedDate: row.exportedDate?.toISOString() || "" })),
      history,
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not load fulfillment controls." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = getDb();
    if (body.action === "control") {
      const appMailingId = String(body.mailingId || "").trim();
      const sourceRow = String(body.sourceRow || "").trim();
      const control = body.control as FulfillmentControl | undefined;
      if (!appMailingId || !sourceRow || !control) return Response.json({ error: "Mailing and control are required." }, { status: 400 });
      if (!FULFILLMENT_OWNERS.includes(control.owner) || !LATE_ADDENDUM_STATUSES.includes(control.lateAddendumStatus) || !FULFILLMENT_STATUSES.includes(control.fulfillmentStatus)) return Response.json({ error: "Invalid fulfillment control." }, { status: 400 });
      const mailing = await resolveMailing(db, appMailingId, sourceRow);
      if (!mailing) return Response.json({ error: "Could not identify this mailing safely." }, { status: 409 });
      await db.insert(fulfillmentControls).values({
        mailingId: mailing.id,
        owner: control.owner,
        excludeFromPrinter: Boolean(control.excludeFromPrinter),
        paymentCleared: Boolean(control.paymentCleared),
        mailingEligible: Boolean(control.mailingEligible),
        lateAddendumStatus: control.lateAddendumStatus,
        fulfillmentStatus: control.fulfillmentStatus,
        qcInitials: String(control.qcInitials || "").slice(0, 12),
        batchName: String(control.batchName || "").slice(0, 120),
      }).onConflictDoUpdate({ target: fulfillmentControls.mailingId, set: {
        owner: control.owner,
        excludeFromPrinter: Boolean(control.excludeFromPrinter),
        paymentCleared: Boolean(control.paymentCleared),
        mailingEligible: Boolean(control.mailingEligible),
        lateAddendumStatus: control.lateAddendumStatus,
        fulfillmentStatus: control.fulfillmentStatus,
        qcInitials: String(control.qcInitials || "").slice(0, 12),
        batchName: String(control.batchName || "").slice(0, 120),
        updatedAt: new Date(),
      }});
      return Response.json({ ok: true });
    }

    if (body.action === "recordExport") {
      const batchDate = String(body.batchDate || "");
      const batchName = String(body.batchName || "").slice(0, 120);
      const exportKind = String(body.exportKind || "");
      const designGroup = String(body.designGroup || "").slice(0, 120);
      const snapshot = Array.isArray(body.snapshot) ? body.snapshot.slice(0, 1000) : [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(batchDate) || !batchName || !LATE_ADDENDUM_STATUSES.includes(exportKind as never) || !designGroup || !snapshot.length) return Response.json({ error: "Complete export information is required." }, { status: 400 });
      const exportedBy = await actorEmail();
      await db.transaction(async (tx) => {
        await tx.insert(fulfillmentExports).values({ batchDate, batchName, exportKind, designGroup, rowCount: snapshot.length, snapshot, exportedBy });
        for (const item of designGroup === "COMBINED_PRODUCTION_LIST" ? [] : snapshot) {
          if (!item || typeof item !== "object") continue;
          const entry = item as Record<string, unknown>;
          const matches = await tx.select({ id: mailings.id }).from(mailings).where(and(eq(mailings.appMailingId, String(entry.mailingId || "")), eq(mailings.lastSourceRow, String(entry.sourceRow || "")))).limit(2);
          if (matches.length !== 1) continue;
          await tx.insert(fulfillmentControls).values({ mailingId: matches[0].id, paymentCleared: true, mailingEligible: true, fulfillmentStatus: "Exported", exportedDate: new Date(), batchName })
            .onConflictDoUpdate({ target: fulfillmentControls.mailingId, set: { fulfillmentStatus: "Exported", exportedDate: new Date(), batchName, updatedAt: new Date() } });
        }
      });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown fulfillment action." }, { status: 400 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not save fulfillment changes." }, { status: 500 });
  }
}
