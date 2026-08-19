import { getDb } from "@/db";
import { auth } from "@/auth";
import { ingestionEvents } from "@/db/schema/ingestion_events";
import { auditEvents } from "@/db/schema/audit_events";
import { currentChangeMarker } from "@/lib/change-marker";
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

// What actor_email gets when a request reaches this handler with no
// session. proxy.ts gates every route this one is reachable through, so a
// real browser request should never hit this - but a test (or any other
// direct call bypassing proxy.ts) legitimately has none, and recording
// nothing there is how a null actor_email would silently start meaning two
// different things: "the capture broke" and "there genuinely was no
// session." This sentinel is written instead of null specifically so a
// later reader of audit_events sees an unmistakable, honest value rather
// than a blank cell that could be either. Exported only for
// tests/audit-events.e2e.test.mjs, which asserts audit rows written by this
// repo's own (proxy.ts-bypassing) e2e harness record exactly this sentinel
// - not consumed by any runtime caller.
export const NO_SESSION_ACTOR = "unauthenticated";

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
    // lib/client/selectors.ts's effectiveMailing() falls through to
    // mailing.status when there's no override, which is exactly the
    // already-current value.
    const db = getDb();
    const [dataset, componentOverrides, reviewed] = await Promise.all([
      buildDatasetFromTables(),
      fetchComponentOverrides(db),
      fetchReviewedExceptionKeys(db),
    ]);

    // Read after building the response above, not before - deliberately.
    // A write racing this request then produces a marker that's already
    // higher than what the dataset/overrides above actually reflect, which
    // can only make a later poll compare against a baseline that's too
    // high, not too low. That errs toward this client occasionally
    // reporting a false "stale" (asking to refresh for a change it may
    // already mostly have) rather than a false "current" (silently
    // treating itself as up to date when it isn't) - the safe direction
    // for a feature whose whole job is warning about acting on stale data.
    const marker = await currentChangeMarker(db);

    return Response.json({ statusOverrides: {}, componentOverrides, reviewed, dataset, marker });
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

    // Resolved once, before the transaction, and reused for every audit row
    // this request produces (a crmDataset import writes one row itself
    // below; a mailingStatus/componentStatus/reviewedException write writes
    // at most one, since each POST addresses exactly one key). See
    // NO_SESSION_ACTOR above for what a missing session becomes.
    //
    // auth() (zero-arg form) reads the session via next/headers, which
    // depends on Next's own App Router request-scope context - present for
    // every real request (proxy.ts already guarantees one exists by the
    // time it reaches here), but genuinely absent when this route's POST is
    // invoked directly, bypassing Next's server, the way this repo's own
    // e2e suite calls route handlers (tests/*.e2e.test.mjs, see
    // docs/testing.md) - Next's own next/dynamic-api-wrong-context error
    // (E251, "was called outside a request scope") is the honest signal for
    // exactly that case, not a bug to route around. Caught narrowly by that
    // specific code (not swallowed generically) and treated the same as a
    // real "no session" - which, outside a real request scope, it actually
    // is.
    let actorEmail = NO_SESSION_ACTOR;
    try {
      const session = await auth();
      actorEmail = session?.user?.email ?? NO_SESSION_ACTOR;
    } catch (error) {
      const code = error && typeof error === "object" && "__NEXT_ERROR_CODE" in error ? (error as { __NEXT_ERROR_CODE: unknown }).__NEXT_ERROR_CODE : undefined;
      if (code !== "E251") throw error;
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
    // Populated inside the transaction below (crmDataset only) and read
    // again after it commits, to include in the response - see the
    // `Response.json` call at the bottom of this function.
    let importSummary: Awaited<ReturnType<typeof writeImport>> | null = null;

    const db = getDb();
    await db.transaction(async (tx) => {
      if (kind === "crmDataset" && crmDatasetPayload) {
        const seed = crmDatasetPayload.seed as unknown as Parameters<typeof writeImport>[0];
        await assertNotCatastrophicDeletion(seed, tx, Boolean(payload.confirmLargeDelete));
        importSummary = await writeImport(seed, tx);
        const summary = `${seed.mailings.length} mailings, ${seed.subscribers.length} subscribers, ${seed.exceptions.length} exceptions - ${crmDatasetPayload.sourceName}`;
        await tx.insert(ingestionEvents).values({
          source: "manual_spreadsheet",
          rawPayload: crmDatasetPayload.raw,
          status: "success",
          summary,
          skipped: importSummary.skipped,
        });
        // One audit_events row per import, same summary ingestion_events
        // already recorded above - so a single chronological read of
        // audit_events shows imports alongside status changes instead of
        // mysteriously skipping them. No previousValue: an import isn't a
        // single-field change with one prior, it's a bulk replace.
        await tx.insert(auditEvents).values({ actorEmail, kind, itemKey: key, previousValue: null, newValue: summary });
      } else if (kind === "mailingStatus") {
        const outcome = await writeMailingStatus(key, value, tx);
        if (outcome) {
          await tx.insert(auditEvents).values({ actorEmail, kind, itemKey: key, previousValue: outcome.previousValue, newValue: outcome.newValue });
        }
      } else if (kind === "componentStatus") {
        const outcome = await writeComponentStatus(key, value, tx);
        if (outcome) {
          await tx.insert(auditEvents).values({ actorEmail, kind, itemKey: key, previousValue: outcome.previousValue, newValue: outcome.newValue });
        }
      } else if (kind === "reviewedException") {
        const outcome = await writeReviewedException(key, tx);
        if (outcome) {
          await tx.insert(auditEvents).values({ actorEmail, kind, itemKey: key, previousValue: outcome.previousValue, newValue: outcome.newValue });
        }
      }
    });

    // Read after the transaction has committed, so a soft-skip (no audit
    // row written - see lib/change-marker.ts) correctly returns the
    // unchanged current marker rather than a stale pre-transaction value,
    // and a real change correctly returns the marker its own audit row
    // just became. lib/client/save-failures.ts's saveSharedState reads
    // this on a successful save to advance the caller's own baseline
    // (lib/client/staleness.ts) - so the user's own change never makes
    // their own page look stale.
    const marker = await currentChangeMarker(db);

    // `importSummary` is null for every kind except crmDataset (nothing
    // else calls writeImport) - `skipped`/`totalRows`/`mailingsWritten`
    // are simply absent from the response body for those, rather than
    // present as null/zero, so a client checking `"skipped" in body`
    // can't mistake "not an import" for "an import that skipped nothing."
    return Response.json({ ok: true, marker, ...(importSummary ? { importSummary } : {}) });
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

