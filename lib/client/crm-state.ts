/**
 * The CRM's client-side state and its three write-through mutators
 * (updateMailingStatus/updateComponentStatus/updateEnvelopeStatus - each
 * writes an override, persists it locally, and POSTs it). Extracted from
 * app/crm/legacy-app.js (step 4 of the app.js decomposition - see
 * CLAUDE.md).
 *
 * createCrmState() is a factory, not a module-level singleton, and that's
 * deliberate: tests/e2e-helpers.mjs's loadAppJsSandbox() gives each snapshot
 * case a fresh legacy-app.js module instance via a `?t=<counter>`
 * cache-buster, which only works because state lives inside that
 * per-import-evaluated module. A singleton exported directly from this file
 * would be created once, the first time any specifier resolving here is
 * imported, and then be silently SHARED across every "fresh" sandbox
 * afterward - state would leak between snapshot cases even though each one
 * looks like it's calling into a brand-new app.js. app/crm/legacy-app.js
 * calls createCrmState() itself, at its own module top level, so a fresh
 * import of *that* module (which the cache-buster does guarantee) really
 * does produce a fresh state object every time. See
 * tests/crm-state-isolation.test.mjs for the test that locks this in.
 */

import type { Dataset } from "../domain/dataset";
import type { MailingLike } from "../domain/keys";
import { componentKey, mailingKey } from "../domain/keys";
import { saveComponentOverrides, saveStatusOverrides } from "./local-overrides";
import { saveSharedState } from "./shared-state-client";
import { effectiveMailings } from "./selectors";
import type { SaveFailureStore } from "./save-failures";
import type { StalenessStore } from "./staleness";

export interface CrmState {
  activeView: string;
  query: string;
  statusFilter: string;
  batchFilter: string;
  printScope: string;
  printStockFilter: string;
  packetScope: string;
  syncSubscriberId: string;
  syncSubscriptionId: string;
  syncPlan: string;
  syncOrderDate: string;
  sampleType: string;
  selectedSubscriberId: string;
  importPreview: unknown;
  importStatus: string;
  importBusy: boolean;
  importInfo: unknown;
  reviewed: Set<string>;
  statusOverrides: Record<string, string>;
  componentOverrides: Record<string, string>;
  seed: Dataset | null;
}

// The shape updateEnvelopeStatus's monthlyEnvelopeTargets grouping needs -
// a subset of DatasetMailing, kept narrow so callers don't have to build a
// full mailing object just to change one envelope's status.
export interface EnvelopeMailingLike extends MailingLike {
  plan: string;
  subscriptionId: string;
  shipDate: string;
}

export interface CrmStateStore {
  state: CrmState;
  updateMailingStatus(mailing: MailingLike, status: string): void;
  updateComponentStatus(mailing: MailingLike, field: string, status: string): void;
  updateEnvelopeStatus(mailing: EnvelopeMailingLike, status: string): void;
}

function mailingMonthKey(mailing: { shipDate: string }): string {
  return String(mailing.shipDate || "").slice(0, 7);
}

export function createCrmState(failureStore: SaveFailureStore, stalenessStore: StalenessStore): CrmStateStore {
  const state: CrmState = {
    activeView: "queue",
    query: "",
    statusFilter: "Open",
    batchFilter: "next",
    printScope: "monthly",
    printStockFilter: "all",
    packetScope: "all",
    syncSubscriberId: "",
    syncSubscriptionId: "",
    syncPlan: "Month-to-month",
    syncOrderDate: "2026-07-12",
    sampleType: "Kid",
    selectedSubscriberId: "",
    importPreview: null,
    importStatus: "",
    importBusy: false,
    importInfo: null,
    reviewed: new Set(),
    statusOverrides: {},
    componentOverrides: {},
    seed: null,
  };

  function updateMailingStatus(mailing: MailingLike, status: string): void {
    const key = mailingKey(mailing);
    state.statusOverrides[key] = status;
    saveStatusOverrides(state.statusOverrides);
    saveSharedState("mailingStatus", key, status, failureStore, stalenessStore);
  }

  function updateComponentStatus(mailing: MailingLike, field: string, status: string): void {
    const key = componentKey(mailing, field);
    state.componentOverrides[key] = status;
    saveComponentOverrides(state.componentOverrides);
    saveSharedState("componentStatus", key, status, failureStore, stalenessStore);
  }

  function monthlyEnvelopeTargets(mailing: EnvelopeMailingLike): EnvelopeMailingLike[] {
    if (mailing.plan !== "Month-to-month" || !mailing.subscriptionId || !mailing.shipDate) return [mailing];
    const monthKey = mailingMonthKey(mailing);
    // Non-null assertion, not a guard: state.seed is Dataset | null in the
    // type system, but the original code (state.seed.mailings.map(...))
    // threw on a null seed rather than handling it - preserved exactly,
    // since this is only ever called after initializeCrm() has populated
    // state.seed.
    const targets = effectiveMailings(state.seed!, state.statusOverrides).filter(
      (item) => item.plan === "Month-to-month" && item.subscriptionId === mailing.subscriptionId && mailingMonthKey(item) === monthKey,
    );
    return targets.length ? targets : [mailing];
  }

  function updateEnvelopeStatus(mailing: EnvelopeMailingLike, status: string): void {
    monthlyEnvelopeTargets(mailing).forEach((target) => updateComponentStatus(target, "envelope", status));
  }

  return { state, updateMailingStatus, updateComponentStatus, updateEnvelopeStatus };
}
