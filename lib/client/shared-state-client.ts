/**
 * HTTP client for /api/shared-state: posting a status/component-status
 * change, posting a freshly-imported spreadsheet dataset, and pulling the
 * current shared dataset/overrides down on load. Extracted from
 * app/crm/legacy-app.js (step 4 of the app.js decomposition - see
 * CLAUDE.md).
 *
 * saveSharedState's fire-and-forget error swallowing (`.catch(() => {})`)
 * is preserved exactly - it's a known, documented gap (CLAUDE.md SS8: no
 * retry, no user-visible failure indicator), not something this extraction
 * fixes. loadSharedState's merge semantics (spread overrides over existing
 * ones, add reviewed keys to a Set, only replace `seed` when
 * `shared.dataset?.summary` is truthy) are preserved exactly too - every one
 * of those conditions is load-bearing for what survives a page refresh.
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
 */

import type { Dataset, DatasetSummary } from "../domain/dataset";
import { saveComponentOverrides, saveReviewedExceptions, saveStatusOverrides } from "./local-overrides";

export function saveSharedState(kind: string, key: string, value: string): void {
  fetch("/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, key, value }),
  }).catch(() => {
    // Keep local changes usable if the shared endpoint is briefly unavailable.
  });
}

export interface SharedDatasetPayload {
  seed: Dataset;
  sourceName: string;
  uploadedAt: string;
  summary: DatasetSummary;
}

export async function saveSharedDataset(seed: Dataset, sourceName: string): Promise<SharedDatasetPayload> {
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
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Could not save the imported spreadsheet.");
  }
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

export async function loadSharedState(target: SharedStateTarget): Promise<void> {
  const response = await fetch("/api/shared-state", { cache: "no-store" });
  if (!response.ok) return;

  const shared = await response.json();
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
