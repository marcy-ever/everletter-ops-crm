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
 *
 * notifyViewChanged()/subscribeViewChanged() (added for the app.js
 * decomposition's Phase 1 - CLAUDE.md - once a view is React-hosted,
 * something has to tell React when it might need to re-render) exist so
 * `app/crm/CrmApp.tsx` can *observe* `state.activeView` instead of
 * duplicating it into React state - `state.activeView` stays the single
 * source of truth, mutated directly by legacy nav handlers exactly as
 * before, and this is just a signal that a mutation may have happened.
 * Deliberately colocated here rather than in a new standalone module:
 * `state.activeView` already lives on the object this factory owns, and
 * every caller that already destructures this factory's return value
 * (today, only app/crm/legacy-app.js's own module top level) gets the
 * subscription for free without a second import.
 *
 * Revised in step 8 (Sync Simulator) from what step 6 originally said
 * here - worth recording exactly what changed and why, not just the new
 * shape, since step 6 explicitly deferred this: it called
 * notifyViewChanged() a narrow "the active view may have changed" signal
 * and said a future view reacting to something else (an override
 * changing, a form field changing) would be "a different, later
 * decision." Step 8 is that later decision, forced by a real case rather
 * than a speculative one: Sync's four inputs mutate state.syncSubscriberId/
 * syncPlan/syncOrderDate/syncSubscriptionId, never state.activeView, so a
 * React view watching only `state.activeView` via useSyncExternalStore
 * would never re-render on an input change - React's Object.is comparison
 * on the snapshot sees the same string and correctly (by
 * useSyncExternalStore's own contract) bails out.
 *
 * Fixed by generalizing the signal itself rather than adding a second,
 * parallel one per concern: getRenderGeneration() is a plain counter,
 * incremented every time notifyViewChanged() fires (regardless of what
 * changed - the name describes when it's called, not what it observes,
 * which was already true before this revision). A React view's snapshot
 * function can combine `state.activeView` with this counter so
 * useSyncExternalStore sees a genuinely new value on ANY render-worthy
 * mutation, not just an active-view switch - see app/crm/CrmApp.tsx's own
 * getViewSnapshot(). This is the one mechanism every interactive migrated
 * view (Sync now; Needs Review/Import/Production Queue/QA/Packet/Bins/
 * Subscribers next) subscribes to, rather than each growing its own
 * dedicated channel - "the CRM re-rendered, for any reason" was already
 * what notifyViewChanged() meant in practice (it's called from
 * renderView(), unconditionally, on every render), this just makes
 * React's own subscription actually observe that instead of a narrower
 * slice of it.
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
  // Called by app/crm/legacy-app.js's renderView() every time it runs
  // (which is every time the active view might have changed, regardless
  // of which code path changed it - nav click, hash-based initial load,
  // etc.) - a subscriber doesn't need to know why, only that it might be
  // stale. Safe to call more than necessary: a subscriber reading
  // state.activeView unchanged is a correct, harmless no-op.
  notifyViewChanged(): void;
  subscribeViewChanged(listener: () => void): () => void;
  // A plain counter, bumped once per notifyViewChanged() call - see this
  // file's own header (the step 8 revision) for why a React view's
  // useSyncExternalStore snapshot needs to combine this with
  // state.activeView rather than watching state.activeView alone.
  getRenderGeneration(): number;
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

  const viewChangeListeners = new Set<() => void>();
  let renderGeneration = 0;

  function notifyViewChanged(): void {
    renderGeneration += 1;
    viewChangeListeners.forEach((listener) => listener());
  }

  function subscribeViewChanged(listener: () => void): () => void {
    viewChangeListeners.add(listener);
    return () => viewChangeListeners.delete(listener);
  }

  function getRenderGeneration(): number {
    return renderGeneration;
  }

  return {
    state,
    updateMailingStatus,
    updateComponentStatus,
    updateEnvelopeStatus,
    notifyViewChanged,
    subscribeViewChanged,
    getRenderGeneration,
  };
}
