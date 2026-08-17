import assert from "node:assert/strict";
import test from "node:test";
import { createAppState } from "../app/crm/shell/crm-app-state.ts";
import { renderView } from "../app/crm/shell/render-shell.ts";
import { bootCrmApp } from "../app/crm/shell/init-crm-app.ts";
import { installShellDomStub } from "./shell-test-helpers.mjs";

// Covers the pure-logic half of app/crm/CrmApp.tsx's React-hosting seam:
// lib/client/crm-state.ts's notifyViewChanged()/subscribeViewChanged(),
// bundled by app/crm/shell/crm-app-state.ts's createAppState() and
// consumed by CrmApp.tsx's useSyncExternalStore. This is genuinely
// everything about the seam that's testable without a real DOM/browser -
// React's own reconciliation of the portal into #reactViewMount
// (createPortal, in CrmApp.tsx) needs an actual browser to verify for
// real.
//
// bootCrmApp() is called once per test purely to bind
// app/crm/shell/render-shell.ts's DOM element refs (bindShellElements) so
// renderView() itself has somewhere real (if stubbed) to write - the
// actual assertions below are all about notifyViewChanged()'s own call
// count/generation, not about what got painted.
function minimalSeed() {
  return { summary: {}, mailings: [], subscribers: [], recipients: [], subscriptions: [], orders: [], exceptions: [] };
}

test("renderView() calls notifyViewChanged() every time it runs, so a subscriber can react to a view switch", () => {
  installShellDomStub();
  const appState = createAppState();
  appState.state.seed = minimalSeed();
  bootCrmApp(appState);

  let calls = 0;
  const unsubscribe = appState.subscribeViewChanged(() => {
    calls += 1;
  });

  appState.state.activeView = "automation";
  renderView(appState.state, appState.notifyViewChanged);
  assert.equal(calls, 1);

  appState.state.activeView = "queue";
  renderView(appState.state, appState.notifyViewChanged);
  assert.equal(calls, 2, "every renderView() call notifies, regardless of which view it's for - a subscriber decides for itself whether anything relevant changed");

  unsubscribe();
  renderView(appState.state, appState.notifyViewChanged);
  assert.equal(calls, 2, "no further notifications after unsubscribe");
});

test("subscribeViewChanged supports multiple independent subscribers", () => {
  installShellDomStub();
  const appState = createAppState();
  appState.state.seed = minimalSeed();
  bootCrmApp(appState);

  let a = 0;
  let b = 0;
  appState.subscribeViewChanged(() => {
    a += 1;
  });
  const unsubscribeB = appState.subscribeViewChanged(() => {
    b += 1;
  });

  renderView(appState.state, appState.notifyViewChanged);
  assert.equal(a, 1);
  assert.equal(b, 1);

  unsubscribeB();
  renderView(appState.state, appState.notifyViewChanged);
  assert.equal(a, 2, "unsubscribing one listener must not affect another");
  assert.equal(b, 1);
});

// getRenderGeneration() (lib/client/crm-state.ts) closes a real gap: a
// React view watching state.activeView alone via useSyncExternalStore
// would never re-render on an input change, since those mutate a
// different state field entirely, never state.activeView.
test("getRenderGeneration() increments on every notifyViewChanged() call, regardless of what changed - the signal app/crm/CrmApp.tsx's snapshot combines with state.activeView", () => {
  installShellDomStub();
  const appState = createAppState();
  appState.state.seed = minimalSeed();
  bootCrmApp(appState);

  const before = appState.getRenderGeneration();
  appState.state.activeView = "sync";
  renderView(appState.state, appState.notifyViewChanged);
  assert.equal(appState.getRenderGeneration(), before + 1);

  // Not just view switches - any notifyViewChanged() call at all, which is
  // exactly what a Sync input's onChange handler triggers after writing
  // into `state` (see app/crm/CrmApp.tsx's REACT_VIEWS.sync entry).
  appState.notifyViewChanged();
  assert.equal(appState.getRenderGeneration(), before + 2);
});
