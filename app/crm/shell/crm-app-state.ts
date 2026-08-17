/**
 * Bootstraps the CRM's shared client-side state: the save-failure store,
 * the staleness store, and lib/client/crm-state.ts's CrmStateStore (state
 * itself plus its three write-through mutators and the render-generation
 * signal React observes). Moved from app/crm/legacy-app.js's own module
 * top level (Phase 2, the monolith's deletion - CLAUDE.md).
 *
 * createAppState() is a factory, not just a singleton export, on purpose:
 * the real app needs exactly one shared instance for the page's lifetime
 * (the `appState` singleton below, imported by app/crm/CrmApp.tsx and
 * app/crm/shell/init-crm-app.ts), but a good number of e2e write-path
 * tests each need their own fresh, isolated instance so one test's writes
 * can't leak into another's. Before this move, that isolation came from
 * tests/e2e-helpers.mjs's loadAppJsSandbox() forcing a fresh dynamic
 * import() of the whole legacy-app.js module (a `?t=<counter>`
 * cache-buster) - the only way to get a "fresh module instance" when the
 * factory call lived at that module's own top level with no way to invoke
 * it a second time from outside. Exposing the factory directly here means
 * a test just calls createAppState() itself for a fresh instance - no
 * module-cache trick, no DOM stub, nothing sandboxed. See
 * tests/crm-app-state-isolation.test.mjs for the test that locks this in
 * (the harness this replaces is gone, but the isolation property it
 * guarded still matters and still has a test).
 */

import { createCrmState, type CrmStateStore } from "@/lib/client/crm-state";
import { createSaveFailureStore, type SaveFailureStore } from "@/lib/client/save-failures";
import { createStalenessStore, type StalenessStore } from "@/lib/client/staleness";

export interface AppState extends CrmStateStore {
  saveFailures: SaveFailureStore;
  staleness: StalenessStore;
}

export function createAppState(): AppState {
  const saveFailures = createSaveFailureStore();
  const staleness = createStalenessStore();
  const crmState = createCrmState(saveFailures, staleness);
  return { ...crmState, saveFailures, staleness };
}

// The one real instance the running app shares for the page's lifetime -
// created once, at this module's own top level, exactly the way
// app/crm/legacy-app.js used to. app/crm/CrmApp.tsx imports the
// destructured pieces below directly; app/crm/shell/init-crm-app.ts's
// initCrmApp() imports `appState` itself (the whole bundle) so it can pass
// the identical object bootCrmApp() takes as an explicit parameter.
export const appState = createAppState();

export const {
  state,
  updateMailingStatus,
  updateComponentStatus,
  updateEnvelopeStatus,
  notifyViewChanged,
  subscribeViewChanged,
  getRenderGeneration,
  saveFailures,
  staleness,
} = appState;
