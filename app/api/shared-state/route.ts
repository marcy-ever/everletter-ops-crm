import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmState } from "@/db/schema";

type StateKind = "mailingStatus" | "componentStatus" | "reviewedException" | "crmDataset";

const allowedKinds = new Set<StateKind>([
  "mailingStatus",
  "componentStatus",
  "reviewedException",
  "crmDataset",
]);

function toStatePayload(rows: Array<{ kind: string; itemKey: string; value: string }>) {
  const statusOverrides: Record<string, string> = {};
  const componentOverrides: Record<string, string> = {};
  const reviewed: string[] = [];
  let dataset: unknown = null;

  for (const row of rows) {
    if (row.kind === "mailingStatus") statusOverrides[row.itemKey] = row.value;
    if (row.kind === "componentStatus") componentOverrides[row.itemKey] = row.value;
    if (row.kind === "reviewedException" && row.value === "1") reviewed.push(row.itemKey);
    if (row.kind === "crmDataset" && row.itemKey === "current") {
      try {
        dataset = JSON.parse(row.value);
      } catch {
        dataset = null;
      }
    }
  }

  return { statusOverrides, componentOverrides, reviewed, dataset };
}

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({ kind: crmState.kind, itemKey: crmState.itemKey, value: crmState.value })
      .from(crmState)
      .orderBy(desc(crmState.updatedAt));

    return Response.json(toStatePayload(rows));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load shared CRM state.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      kind?: StateKind;
      key?: string;
      value?: string;
    };

    const kind = payload.kind;
    const key = payload.key?.trim() ?? "";
    const value = String(payload.value ?? "");

    if (!kind || !allowedKinds.has(kind)) {
      return Response.json({ error: "Unknown shared state type." }, { status: 400 });
    }
    if (!key) {
      return Response.json({ error: "Shared state key is required." }, { status: 400 });
    }
    if (kind === "crmDataset" && key !== "current") {
      return Response.json({ error: "CRM dataset key must be current." }, { status: 400 });
    }

    const id = `${kind}::${key}`;
    const db = getDb();
    await db
      .insert(crmState)
      .values({ id, kind, itemKey: key, value })
      .onConflictDoUpdate({
        target: crmState.id,
        set: { value, updatedAt: sql`now()` },
      });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save shared CRM state.";
    return Response.json({ error: message }, { status: 500 });
  }
}

