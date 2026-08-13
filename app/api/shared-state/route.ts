import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmState } from "@/db/schema";
import {
  dualWriteComponentStatus,
  dualWriteImport,
  dualWriteMailingStatus,
  dualWriteReviewedException,
} from "@/lib/dual-write";

type StateKind = "mailingStatus" | "componentStatus" | "reviewedException" | "crmDataset";

const allowedKinds = new Set<StateKind>([
  "mailingStatus",
  "componentStatus",
  "reviewedException",
  "crmDataset",
]);

function toErrorPayload(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
  return cause ? { error: message, cause } : { error: message };
}

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
    console.error(error);
    return Response.json(toErrorPayload(error, "Could not load shared CRM state."), { status: 500 });
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
    // Option B Phase 2: the crm_state blob write and the normalized-table
    // dual-write are now one transaction - both succeed or both roll back.
    // No inner try/catch around the dual-write dispatch anymore: a real
    // failure there (as opposed to the dualWrite* functions' own expected
    // skip-and-log cases) is supposed to fail this request now, and the
    // outer try/catch below already turns a thrown error into a real 500.
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .insert(crmState)
        .values({ id, kind, itemKey: key, value })
        .onConflictDoUpdate({
          target: crmState.id,
          set: { value, updatedAt: sql`now()` },
        });

      if (kind === "crmDataset" && key === "current") {
        const parsed = JSON.parse(value) as { seed?: unknown };
        if (parsed.seed) await dualWriteImport(parsed.seed as Parameters<typeof dualWriteImport>[0], tx);
      } else if (kind === "mailingStatus") {
        await dualWriteMailingStatus(key, value, tx);
      } else if (kind === "componentStatus") {
        await dualWriteComponentStatus(key, value, tx);
      } else if (kind === "reviewedException") {
        await dualWriteReviewedException(key, tx);
      }
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json(toErrorPayload(error, "Could not save shared CRM state."), { status: 500 });
  }
}

