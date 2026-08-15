import { getDb } from "@/db";
import { ingestionEvents } from "@/db/schema/ingestion_events";
import {
  writeComponentStatus,
  writeImport,
  writeMailingStatus,
  writeReviewedException,
} from "@/lib/write-to-tables";
import { buildDatasetFromTables } from "@/lib/build-dataset-from-tables";
import { fetchComponentOverrides, fetchReviewedExceptionKeys } from "@/lib/build-overrides-from-tables";
import {
  CatastrophicDeletionError,
  PayloadTooLargeError,
  SharedStateValidationError,
  assertNotCatastrophicDeletion,
  assertPayloadSize,
  parseAndValidateCrmDatasetValue,
  validateComponentStatusPayload,
  validateMailingStatusPayload,
  validateReviewedExceptionPayload,
} from "@/lib/validate-shared-state";

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
    // Size cap first, before the body is even parsed. content-length is
    // checked when present (cheap, avoids reading a huge body at all),
    // but a client can omit or lie about it, so the actual read body is
    // measured too - see lib/validate-shared-state.ts for the measured
    // real-fixture size behind the 10 MiB limit.
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredLength = Number(contentLengthHeader);
      if (Number.isFinite(declaredLength)) assertPayloadSize(declaredLength);
    }
    const rawBody = await request.text();
    assertPayloadSize(Buffer.byteLength(rawBody, "utf8"));

    let payload: { kind?: StateKind; key?: string; value?: string; confirmLargeDelete?: boolean };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Request body is not valid JSON." }, { status: 400 });
    }

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

    // Shape validation happens before the transaction opens, on purpose -
    // see lib/validate-shared-state.ts's module comment for why this
    // can't live inside lib/write-to-tables.ts instead. Each of these
    // throws SharedStateValidationError on a malformed key or an
    // unrecognized value; nothing here checks business rules (a real
    // import legitimately contains rows the app itself flags as broken).
    let crmDatasetPayload: ReturnType<typeof parseAndValidateCrmDatasetValue> | null = null;
    if (kind === "crmDataset") {
      crmDatasetPayload = parseAndValidateCrmDatasetValue(value);
    } else if (kind === "mailingStatus") {
      validateMailingStatusPayload(key, value);
    } else if (kind === "componentStatus") {
      validateComponentStatusPayload(key, value);
    } else if (kind === "reviewedException") {
      validateReviewedExceptionPayload(key);
    }

    // The write-to-tables dispatch runs inside a transaction (`tx`, not
    // `db`, even though it's the only thing in it) so a real failure (as
    // opposed to the write* functions' own expected skip-and-log cases)
    // rolls back cleanly and propagates to the outer try/catch below,
    // which turns it into a real 500. For crmDataset specifically, the
    // catastrophic-deletion guard and the ingestion_events row both run
    // inside this same transaction: the guard so its read-then-decide is
    // consistent with the write that follows, and the event so a rolled-
    // back import can never leave behind a row claiming it succeeded.
    const db = getDb();
    await db.transaction(async (tx) => {
      if (kind === "crmDataset" && crmDatasetPayload) {
        const seed = crmDatasetPayload.seed as unknown as Parameters<typeof writeImport>[0];
        await assertNotCatastrophicDeletion(seed, tx, Boolean(payload.confirmLargeDelete));
        await writeImport(seed, tx);
        await tx.insert(ingestionEvents).values({
          source: "manual_spreadsheet",
          rawPayload: crmDatasetPayload.raw,
          status: "success",
          summary: `${seed.mailings.length} mailings, ${seed.subscribers.length} subscribers, ${seed.exceptions.length} exceptions - ${crmDatasetPayload.sourceName}`,
        });
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
    if (error instanceof SharedStateValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof CatastrophicDeletionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return Response.json(toErrorPayload(error, "Could not save shared CRM state."), { status: 500 });
  }
}

