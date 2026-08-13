import { getDb } from "@/db";
import {
  dualWriteComponentStatus,
  dualWriteImport,
  dualWriteMailingStatus,
  dualWriteReviewedException,
} from "@/lib/dual-write";
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
    // Option B Phase 2: dataset comes from the normalized tables
    // (lib/build-dataset-from-tables.ts), not the crm_state blob - and as
    // of this step, POST below no longer writes crm_state at all (the
    // table itself still exists, untouched, as a rollback path - see
    // docs/schema-design.md's Phase 2 notes). componentOverrides and
    // reviewed have no equivalent in the Dataset shape (by design - see
    // lib/build-overrides-from-tables.ts's module comment) and are fetched
    // separately. statusOverrides is always {} now: buildMailings() already
    // reads each mailing's live, current status directly from the mailings
    // table (dualWriteMailingStatus writes there directly and is
    // load-bearing as of the transactional-write-path change), so there's
    // nothing left for a separate override map to contribute -
    // public/app.js's effectiveMailing() falls through to mailing.status
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

    // Option B Phase 2: crm_state is no longer written here (GET stopped
    // reading it as of the previous step - see docs/schema-design.md's
    // Phase 2 notes). The table itself is untouched and not dropped - this
    // is only the write going away, kept as its own step so the table
    // remains a free rollback path if this surfaces a problem live. The
    // dual-write dispatch still runs inside a transaction (still using
    // `tx`, not `db`, even though it's now the only thing in it) so a real
    // failure (as opposed to the dualWrite* functions' own expected
    // skip-and-log cases) still rolls back cleanly and propagates to the
    // outer try/catch below, which turns it into a real 500.
    const db = getDb();
    await db.transaction(async (tx) => {
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

