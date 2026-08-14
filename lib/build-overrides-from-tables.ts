/**
 * The two pieces of app/api/shared-state/route.ts's GET response that
 * lib/build-dataset-from-tables.ts's Dataset shape doesn't (and shouldn't)
 * cover, each queried and keyed the same way app.js's own client-side code
 * already expects:
 *
 *  - componentOverrides: mailing_components isn't part of the Dataset shape
 *    at all (envelope/letter/artifact/insert/qa status - written by
 *    lib/write-to-tables.ts's writeComponentStatus). public/app.js's
 *    componentStatus() does `state.componentOverrides[componentKey(mailing,
 *    field)] || defaultComponentStatus(...)` - if this object comes back
 *    empty, every component silently reverts to its default, which is a
 *    real regression, not a missing nice-to-have.
 *  - reviewed exception keys: lib/build-dataset-from-tables.ts's
 *    buildExceptions() deliberately returns ALL exceptions regardless of
 *    the exceptions.reviewed column (summary.exceptionCount/
 *    missingShipDateCount need to keep counting reviewed ones too - see
 *    its module comment). Reviewed-state filtering has always happened
 *    client-side, in public/app.js's isExceptionReviewed()/
 *    activeExceptions(), against a separate `reviewed` key list - this
 *    module supplies that list from the exceptions.reviewed column
 *    directly, without touching buildExceptions()'s contract.
 *
 * Both reuse lib/keys.ts's real componentKey()/exceptionReviewKey() - the
 * same tested, canonical spec write-to-tables's own matching logic uses -
 * rather than re-deriving either key format here.
 *
 * Same shape as lib/build-dataset-from-tables.ts: a pure function per
 * concern that takes already-fetched plain rows (independently testable
 * with small fixtures), plus a thin fetch* wrapper that's the only thing
 * that touches Drizzle.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { mailingComponents } from "../db/schema/mailing_components";
import { mailings } from "../db/schema/mailings";
import { exceptions } from "../db/schema/exceptions";
import { subscriptions } from "../db/schema/subscriptions";
import { componentKey, exceptionReviewKey } from "./keys";

type Db = ReturnType<typeof getDb>;

export interface ComponentOverrideRow {
  componentType: string;
  status: string;
  mailingAppId: string | null;
  mailingSourceRow: string | null;
}

// A component row always has a real mailing behind it (mailing_components.
// mailing_id is a NOT NULL FK) - mailingAppId/mailingSourceRow are typed
// nullable here only because they come through a join; skip-if-missing is
// defense in depth, not an expected case.
export function buildComponentOverrides(rows: ComponentOverrideRow[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const row of rows) {
    if (!row.mailingAppId || !row.mailingSourceRow) continue;
    const key = componentKey({ mailingId: row.mailingAppId, sourceRow: row.mailingSourceRow }, row.componentType);
    overrides[key] = row.status;
  }
  return overrides;
}

export async function fetchComponentOverrides(db: Db): Promise<Record<string, string>> {
  const rows = await db
    .select({
      componentType: mailingComponents.componentType,
      status: mailingComponents.status,
      mailingAppId: mailings.appMailingId,
      mailingSourceRow: mailings.lastSourceRow,
    })
    .from(mailingComponents)
    .innerJoin(mailings, eq(mailingComponents.mailingId, mailings.id));
  return buildComponentOverrides(rows);
}

export interface ReviewedExceptionRow {
  reason: string;
  subscriberId: string | null;
  mailingAppId: string | null;
  shipDate: string | null;
}

// Only emits a key when mailingAppId/shipDate/subscriberId are ALL real -
// exceptionReviewKey() falls back to placeholder strings
// ("unknown-mailing"/"no-ship-date"/etc.) for missing fields, and a key
// built from placeholders would not match the real key app.js's client
// computed for that item, so it's worse than useless here: it would silently
// never match, or (in an unlucky coincidence) match the wrong item. This
// happens for exceptions whose mailing was skipped by lib/write-to-tables.ts
// (the same "subscription-only fallback" case documented in
// lib/build-dataset-from-tables.ts's module comment) - if one of those was
// already reviewed, this module can't reconstruct its key, so it stays
// unreviewed after a reconstruction-backed GET. A narrow, inherited gap,
// not a new one.
export function buildReviewedExceptionKeys(rows: ReviewedExceptionRow[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    if (!row.mailingAppId || !row.shipDate || !row.subscriberId) continue;
    keys.push(exceptionReviewKey({ mailingId: row.mailingAppId, subscriberId: row.subscriberId, reason: row.reason, shipDate: row.shipDate }));
  }
  return keys;
}

export async function fetchReviewedExceptionKeys(db: Db): Promise<string[]> {
  const rows = await db
    .select({
      reason: exceptions.type,
      subscriberId: subscriptions.subscriberId,
      mailingAppId: mailings.appMailingId,
      shipDate: mailings.scheduledDate,
    })
    .from(exceptions)
    .leftJoin(mailings, eq(exceptions.mailingId, mailings.id))
    .leftJoin(subscriptions, eq(exceptions.subscriptionId, subscriptions.id))
    .where(eq(exceptions.reviewed, true));
  return buildReviewedExceptionKeys(rows);
}
