import assert from "node:assert/strict";
import test from "node:test";
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// Covers the pure-logic half of app/crm/CrmApp.tsx's React-hosting seam
// (Phase 1, step 6 - CLAUDE.md): lib/client/crm-state.ts's
// notifyViewChanged()/subscribeViewChanged(), exported from
// app/crm/legacy-app.js and consumed by CrmApp.tsx's useSyncExternalStore.
// This is genuinely everything about the seam that's testable without a
// real DOM/browser - React's own reconciliation of the portal into
// #reactViewMount (createPortal, in CrmApp.tsx) needs an actual browser to
// verify for real; see this task's PR description for exactly what's
// verified there vs. what still needs a manual click-through.
function minimalSeed() {
  return { summary: {}, mailings: [], subscribers: [], recipients: [], subscriptions: [], orders: [], exceptions: [] };
}

test("renderView() calls notifyViewChanged() every time it runs, so a subscriber can react to a view switch", async () => {
  const appJs = await loadAppJsSandbox(undefined, { captureRenders: true });
  appJs.state.seed = minimalSeed();
  let calls = 0;
  const unsubscribe = appJs.subscribeViewChanged(() => {
    calls += 1;
  });

  appJs.state.activeView = "automation";
  appJs.renderView();
  assert.equal(calls, 1);

  appJs.state.activeView = "queue";
  appJs.renderView();
  assert.equal(calls, 2, "every renderView() call notifies, regardless of which view it's for - a subscriber decides for itself whether anything relevant changed");

  unsubscribe();
  appJs.renderView();
  assert.equal(calls, 2, "no further notifications after unsubscribe");
});

test("subscribeViewChanged supports multiple independent subscribers", async () => {
  const appJs = await loadAppJsSandbox(undefined, { captureRenders: true });
  appJs.state.seed = minimalSeed();
  let a = 0;
  let b = 0;
  appJs.subscribeViewChanged(() => {
    a += 1;
  });
  const unsubscribeB = appJs.subscribeViewChanged(() => {
    b += 1;
  });

  appJs.renderView();
  assert.equal(a, 1);
  assert.equal(b, 1);

  unsubscribeB();
  appJs.renderView();
  assert.equal(a, 2, "unsubscribing one listener must not affect another");
  assert.equal(b, 1);
});

// getRenderGeneration() (lib/client/crm-state.ts) was added in step 8
// (Sync Simulator) - see that module's own header for the full gap it
// closes: a React view watching state.activeView alone via
// useSyncExternalStore would never re-render on an input change, since
// those mutate state.syncSubscriberId/etc, never state.activeView.
test("getRenderGeneration() increments on every notifyViewChanged() call, regardless of what changed - the signal app/crm/CrmApp.tsx's snapshot combines with state.activeView", async () => {
  const appJs = await loadAppJsSandbox(undefined, { captureRenders: true });
  appJs.state.seed = minimalSeed();

  const before = appJs.getRenderGeneration();
  appJs.state.activeView = "sync";
  appJs.renderView();
  assert.equal(appJs.getRenderGeneration(), before + 1);

  // Not just view switches - any notifyViewChanged() call at all, which is
  // exactly what a Sync input's onChange handler triggers after writing
  // into `state` (see app/crm/CrmApp.tsx's REACT_VIEWS.sync entry).
  appJs.notifyViewChanged();
  assert.equal(appJs.getRenderGeneration(), before + 2);
});

// "print" (Envelope Print) was the last of the twelve views to migrate
// (step 17, CLAUDE.md - its correctness lands on physical paper, so it
// was deliberately migrated last). With it done, every VIEW_REGISTRY
// entry is now { react: true } - there is no still-legacy view left to
// demonstrate "switching to a react-hosted view clears the previous
// legacy view's stale content" against, so that's no longer the
// property this test can prove. What's still true and worth guarding
// until Phase 2 deletes app/crm/legacy-app.js and this test file's own
// sandbox harness entirely (CLAUDE.md's own "after this merges" note):
// #viewMount stays empty across every view switch, for every view, since
// renderView() no longer writes to it at all. A regression here (some
// future VIEW_REGISTRY entry accidentally losing react: true, or a stray
// direct #viewMount write) would be exactly the kind of legacy-content
// leak the original version of this test caught.
test("#viewMount stays empty across every view - renderView() no longer writes to it for any view, now that all twelve are react-hosted", async () => {
  const appJs = await loadAppJsSandbox(undefined, { captureRenders: true });
  appJs.state.seed = minimalSeed();

  for (const activeView of Object.keys(appJs.VIEW_REGISTRY)) {
    appJs.state.activeView = activeView;
    appJs.renderView();
    assert.equal(appJs.getCapturedHtml("#viewMount"), "", `#viewMount should stay empty for view "${activeView}" - every VIEW_REGISTRY entry is react-hosted now`);
  }
});
