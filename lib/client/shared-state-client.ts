/**
 * HTTP client for /api/shared-state: posting a status/component-status
 * change, posting a freshly-imported spreadsheet dataset, and pulling the
 * current shared dataset/overrides down on load. Extracted from
 * app/crm/legacy-app.js (step 4 of the app.js decomposition - see
 * CLAUDE.md).
 *
 * saveSharedState's fire-and-forget shape is preserved exactly - the
 * caller never awaits or receives a thrown error, so a bulk loop firing
 * this 120 times still fires 120 independent, non-blocking requests, not
 * 120 unhandled rejections. What changed (closing CLAUDE.md SS8's "no
 * user-visible failure indicator" gap): every outcome - network failure,
 * a resolved-but-not-ok response, or success - is now reported to the
 * SaveFailureStore passed in, instead of network failures alone being
 * silently swallowed and everything else being ignored outright (a
 * `response.ok` check never existed before this). The optimistic local
 * state this was protecting (see lib/client/crm-state.ts's mutators) is
 * untouched - this makes that behavior honest, not different.
 * loadSharedState's merge semantics (spread overrides over existing
 * ones, add reviewed keys to a Set, only replace `seed` when
 * `shared.dataset?.summary` is truthy) are preserved exactly too - every
 * one of those conditions is load-bearing for what survives a page
 * refresh.
 *
 * saveSharedDataset wasn't named in this step's task list, but it's the
 * same HTTP-client concern (POSTs to the same endpoint, this time with
 * kind: 'crmDataset') and belongs here alongside saveSharedState/
 * loadSharedState. It used to also assign `state.importInfo = payload`
 * internally; that write moved to its one call site in
 * app/crm/legacy-app.js (`state.importInfo = await saveSharedDataset(...)`)
 * since the function already returned the exact value being assigned - a
 * mechanical relocation, not a behavior change (it still only "happens" on
 * the same success path, since a throw here still skips the assignment at
 * the call site exactly as it skipped it inside the old function body).
 * It stays awaited/throwing at its own call site (the Import Sheet
 * publish flow already awaits it and shows state.importStatus on
 * failure) - not folded into the fire-and-forget SaveFailureStore
 * reporting this file adds for saveSharedState/loadSharedState. It DOES
 * take a StalenessStore now (see below) - an import is as much "the
 * user's own change" as a status flip, and the Import Sheet flow doesn't
 * re-fetch afterward (app/crm/legacy-app.js just assigns state.seed
 * locally), so without this an import would advance the server's change
 * marker while the importer's own view stayed behind - the exact false-
 * "your own page is stale" bug this store exists to prevent, just for a
 * different write path.
 *
 * Every POST /api/shared-state response now carries a `marker` field
 * (the post-write, server-side change marker - see lib/change-marker.ts)
 * alongside its existing `ok`/`error` shape, and GET's response carries
 * one too. saveSharedState/saveSharedDataset read it on a successful
 * response and record it via StalenessStore.recordOwnMarker() so the
 * caller's own write can never make their own page look stale; loadSharedState
 * does the same on a successful load. See lib/client/staleness.ts's own
 * module comment for the full mechanism.
 */

import type { Dataset, DatasetSummary } from "../domain/dataset";
import { saveComponentOverrides, saveReviewedExceptions, saveStatusOverrides } from "./local-overrides";
import type { SaveFailureStore } from "./save-failures";
import type { StalenessStore } from "./staleness";

// Reads a `marker` field (number | null) off an already-parsed response
// body, if present in the expected shape - shared by every call site below
// that reports it to a StalenessStore. Absence (an older/unexpected
// response shape) is silently a no-op, not an error - the marker is a
// staleness-detection nicety, not something a save should fail over.
function recordMarkerFromBody(body: unknown, stalenessStore: StalenessStore): void {
  if (body && typeof body === "object" && "marker" in body) {
    const marker = (body as { marker: unknown }).marker;
    if (typeof marker === "number" || marker === null) {
      stalenessStore.recordOwnMarker(marker);
    }
  }
}

// Reads a POST/GET failure response body for the human-readable message
// lib/validate-shared-state.ts's route handler writes (400/409/413) -
// falls back to a generic, still-honest message when the body isn't
// there or isn't shaped as expected (a genuinely unexpected 500, a body
// that failed to parse as JSON).
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string" && (body as { error: string }).error) {
    return (body as { error: string }).error;
  }
  return fallback;
}

export function saveSharedState(kind: string, key: string, value: string, failureStore: SaveFailureStore, stalenessStore: StalenessStore): void {
  fetch("/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, key, value }),
  })
    .then(async (response) => {
      if (response.ok) {
        failureStore.recordSaveSuccess(kind, key);
        const body: unknown = await response.json().catch(() => null);
        recordMarkerFromBody(body, stalenessStore);
        return;
      }
      const message = await readErrorMessage(response, `The server rejected this save (HTTP ${response.status}).`);
      failureStore.recordSaveFailure(kind, key, message, "http");
    })
    .catch(() => {
      // Keep local changes usable if the shared endpoint is briefly
      // unavailable - preserved exactly (no throw, no revert). The
      // failure itself is no longer silent, though: recorded so the UI
      // can say so, distinct from a resolved-but-rejected response. The
      // "network" cause (as opposed to "http" above) is what lets the
      // banner's guidance sentence tell the two apart - "wait for
      // connectivity" is right here and wrong for a rejected request.
      failureStore.recordSaveFailure(kind, key, "Could not reach the server - check your connection.", "network");
    });
}

export interface SharedDatasetPayload {
  seed: Dataset;
  sourceName: string;
  uploadedAt: string;
  summary: DatasetSummary;
}

export async function saveSharedDataset(seed: Dataset, sourceName: string, stalenessStore: StalenessStore): Promise<SharedDatasetPayload> {
  const payload: SharedDatasetPayload = {
    seed,
    sourceName,
    uploadedAt: new Date().toISOString(),
    summary: seed.summary,
  };
  const response = await fetch("/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "crmDataset", key: "current", value: JSON.stringify(payload) }),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body as { error?: string };
    throw new Error(error.error || "Could not save the imported spreadsheet.");
  }
  recordMarkerFromBody(body, stalenessStore);
  return payload;
}

// The minimal shape loadSharedState needs to read from/write into. Defined
// structurally here (rather than imported from lib/client/crm-state.ts) so
// this module never needs to import that one - crm-state.ts imports this
// module, not the other way around.
export interface SharedStateTarget {
  seed: Dataset | null;
  statusOverrides: Record<string, string>;
  componentOverrides: Record<string, string>;
  reviewed: Set<string>;
}

export async function loadSharedState(target: SharedStateTarget, failureStore: SaveFailureStore, stalenessStore: StalenessStore): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/shared-state", { cache: "no-store" });
  } catch {
    failureStore.recordLoadFailure("Could not reach the server - check your connection.");
    return;
  }
  if (!response.ok) {
    const message = await readErrorMessage(response, `Could not load shared data (HTTP ${response.status}).`);
    failureStore.recordLoadFailure(message);
    return;
  }
  failureStore.recordLoadSuccess();

  const shared = await response.json();
  // Recorded unconditionally on any successful parse, independent of the
  // dataset.summary guard below (that guard is about whether `seed` gets
  // replaced, not about whether the response as a whole is usable) - a
  // fresh load establishes both what this client's view now reflects AND
  // the current server marker, at once. See lib/client/staleness.ts.
  recordMarkerFromBody(shared, stalenessStore);
  if (shared.dataset?.summary) {
    target.seed = shared.dataset;
  }
  if (shared.statusOverrides && typeof shared.statusOverrides === "object") {
    target.statusOverrides = { ...target.statusOverrides, ...shared.statusOverrides };
    saveStatusOverrides(target.statusOverrides);
  }
  if (shared.componentOverrides && typeof shared.componentOverrides === "object") {
    target.componentOverrides = { ...target.componentOverrides, ...shared.componentOverrides };
    saveComponentOverrides(target.componentOverrides);
  }
  if (Array.isArray(shared.reviewed)) {
    shared.reviewed.forEach((key: string) => target.reviewed.add(key));
    saveReviewedExceptions(target.reviewed);
  }
}

// Fire-and-forget, matching saveSharedState's shape exactly - the poll
// loop (app/crm/legacy-app.js) calls this on an interval and never awaits
// it. A failed poll is silent by design (no failureStore involved, no
// error surfaced anywhere): not knowing whether the page is stale isn't
// itself an error worth interrupting anyone over, and a flaky connection
// would otherwise turn this into a second, noisier failure banner right
// next to lib/client/save-failures.ts's - see this task's own design
// requirement.
export function pollChangeMarker(stalenessStore: StalenessStore): void {
  fetch("/api/change-marker", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return;
      const body: unknown = await response.json().catch(() => null);
      if (body && typeof body === "object" && "marker" in body) {
        const marker = (body as { marker: unknown }).marker;
        if (typeof marker === "number" || marker === null) {
          stalenessStore.recordServerMarker(marker);
        }
      }
    })
    .catch(() => {
      // Silent - see the module comment above this function.
    });
}
