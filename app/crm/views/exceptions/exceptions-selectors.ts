/**
 * Needs Review's own derivation, migrated from app/crm/legacy-app.js's
 * renderExceptions() (Phase 1 step 10 - CLAUDE.md). Deliberately thin -
 * almost all the real work (deciding which exceptions are still active,
 * text-matching a query against a row) already lives in
 * lib/client/selectors.ts's activeExceptions()/includesText(), shared with
 * every other view that reads exceptions (e.g. Production Queue's
 * highExceptionMailingIds). This module only adds the one thing that's
 * genuinely specific to this view: the exact field list Needs Review
 * searches (recipientName/reason/mailingId/status/severity) and the
 * 120-row display cap - the same boundary step 7 (Launch Plan) drew
 * between a shared selector and a view-only one.
 *
 * No `today`/`now` parameter - unlike Launch Plan/Sync, nothing here reads
 * the clock at all.
 */

import type { Dataset, DatasetException } from "@/lib/domain/dataset";
import { activeExceptions, includesText } from "@/lib/client/selectors";

export function computeExceptionRows(seed: Dataset, reviewed: Set<string>, query: string): DatasetException[] {
  return activeExceptions(seed, reviewed)
    .filter((row) => includesText([row.recipientName, row.reason, row.mailingId, row.status, row.severity], query))
    .slice(0, 120);
}
