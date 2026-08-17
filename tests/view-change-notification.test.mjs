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

test("switching to a react-hosted view (automation) clears #viewMount instead of leaving the previous legacy view's content", async () => {
  const appJs = await loadAppJsSandbox(undefined, { captureRenders: true });
  appJs.state.activeView = "queue";
  appJs.state.seed = minimalSeed();
  appJs.renderView();
  assert.ok(appJs.getCapturedHtml("#viewMount").length > 0, "sanity check: the legacy queue view actually wrote something first");

  appJs.state.activeView = "automation";
  appJs.renderView();
  assert.equal(appJs.getCapturedHtml("#viewMount"), "", "#viewMount must be cleared, not left showing the previous legacy view's stale content, once the active view is react-hosted");
});
