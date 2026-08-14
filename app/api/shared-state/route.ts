import { getDb } from "@/db";
import {
  writeComponentStatus,
  writeImport,
  writeMailingStatus,
  writeReviewedException,
} from "@/lib/write-to-tables";
import { buildDatasetFromTables } from "@/lib/build-dataset-from-tables";
import { fetchComponentOverrides, fetchReviewedExceptionKeys } from "@/lib/build-overrides-from-tables";

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

export async function GET() {
  try {
    // dataset comes from the normalized tables directly
    // (lib/build-dataset-from-tables.ts) - nothing is cached in between.
    // componentOverrides and reviewed have no equivalent in the Dataset
    // shape (by design - see lib/build-overrides-from-tables.ts's module
    // comment) and are fetched separately. statusOverrides is always {}:
    // buildMailings() already reads each mailing's live, current status
    // directly from the mailings table (writeMailingStatus writes there
    // directly, and that write is load-bearing, not an override), so
    // there's nothing left for a separate override map to contribute -
    // app/crm/legacy-app.js's effectiveMailing() falls through to mailing.status
    // when there's no override, which is exactly the already-current value.
    const db = getDb();
    const [dataset, componentOverrides, reviewed] = await Promise.all([
      buildDatasetFromTables(),
      fetchComponentOverrides(db),
      fetchReviewedExceptionKeys(db),
    ]);

    return Response.json({ statusOverrides: {}, componentOverrides, reviewed, dataset });
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

    // The write-to-tables dispatch runs inside a transaction (`tx`, not
    // `db`, even though it's the only thing in it) so a real failure (as
    // opposed to the write* functions' own expected skip-and-log cases)
    // rolls back cleanly and propagates to the outer try/catch below,
    // which turns it into a real 500.
    const db = getDb();
    await db.transaction(async (tx) => {
      if (kind === "crmDataset" && key === "current") {
        const parsed = JSON.parse(value) as { seed?: unknown };
        if (parsed.seed) await writeImport(parsed.seed as Parameters<typeof writeImport>[0], tx);
      } else if (kind === "mailingStatus") {
        await writeMailingStatus(key, value, tx);
      } else if (kind === "componentStatus") {
        await writeComponentStatus(key, value, tx);
      } else if (kind === "reviewedException") {
        await writeReviewedException(key, tx);
      }
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json(toErrorPayload(error, "Could not save shared CRM state."), { status: 500 });
  }
}

