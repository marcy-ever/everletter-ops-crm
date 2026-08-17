"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { initCrmApp, state, subscribeViewChanged, VIEW_REGISTRY } from "./legacy-app.js";
import Automation from "./views/Automation";
import type { AutomationRule } from "./views/Automation";

// Mounts the legacy CRM monolith into the DOM markup app/page.tsx already
// renders (#viewMount, #topbarMeta, the side-nav buttons, etc.) instead of
// loading it as a separate <Script> tag, AND - as of Phase 1, step 6 of
// the app.js decomposition (CLAUDE.md) - hosts migrated React views
// alongside the eleven still-legacy ones.
//
// The hosting seam, and why it's built this way:
//
//  - state.activeView (app/crm/legacy-app.js) stays the single source of
//    truth for which view is showing, mutated directly by legacy nav
//    handlers exactly as before this change. This component does NOT
//    duplicate it into React state (a second source of truth for "which
//    view is showing" is exactly the kind of problem this project's
//    guidance rules out) - it OBSERVES it, via useSyncExternalStore, the
//    real React API for subscribing to state that lives outside React's
//    own tree. subscribeViewChanged() (lib/client/crm-state.ts, exported
//    from legacy-app.js) is called every time app/crm/legacy-app.js's
//    renderView() runs - i.e. every time the active view might have
//    changed, regardless of which code path changed it - so this
//    component doesn't need to know about individual nav-click/hash-load
//    call sites, only that a render happened.
//  - getSnapshot and getServerSnapshot are the same function
//    (getActiveView) rather than two: state.activeView's module-level
//    default ('queue', lib/client/crm-state.ts) is identical at SSR time
//    and at the moment of React's first client render (initCrmApp() only
//    ever runs inside the effect below, strictly after that first
//    render), so there's no value they could ever legitimately disagree
//    on - using one function makes that guarantee explicit instead of
//    hoping two separately-written functions stay in sync.
//  - React gets its own mount element, #reactViewMount (app/page.tsx),
//    separate from #viewMount. Legacy code writes into #viewMount via
//    raw innerHTML; if React also owned that same node, legacy's next
//    innerHTML write and React's next reconciliation pass would fight
//    over it - a real bug, not a theoretical one. Rendered via
//    createPortal so this component's actual position in the React tree
//    (a sibling of the legacy DOM apparatus, not inside it) doesn't have
//    to match where its output visually needs to appear.
//    app/crm/legacy-app.js's renderView() clears #viewMount whenever the
//    active view is React-hosted (has no `render` function in
//    VIEW_REGISTRY), and this component returns null - which React
//    correctly reconciles as "remove whatever was in #reactViewMount" -
//    for every view that isn't. Exactly one of the two mounts holds
//    content at any moment, by construction on both sides.
//  - VIEW_REGISTRY (app/crm/legacy-app.js) is read here too, not
//    duplicated - a view is React-hosted according to the *same* single
//    registry renderView() already checks, so this component and
//    renderView() can never disagree about which views are which.
//
// Runs initCrmApp() inside a browser-only effect specifically so nothing
// in legacy-app.js executes during SSR, where document/window/localStorage
// don't exist (a "use client" component's render still runs once on the
// server to produce the initial HTML - only its effects are browser-only).
// initCrmApp() itself guards against being called twice, which covers
// React StrictMode double-invoking effects in development.
function getActiveView(): string {
  return state.activeView;
}

export default function CrmApp() {
  useEffect(() => {
    initCrmApp();
  }, []);

  const activeView = useSyncExternalStore(subscribeViewChanged, getActiveView, getActiveView);

  if (typeof document === "undefined") return null;
  const mount = document.getElementById("reactViewMount");
  if (!mount) return null;

  const entry = (VIEW_REGISTRY as Record<string, { react?: boolean }>)[activeView];
  if (!entry?.react) return null;

  if (activeView === "automation") {
    const automationRules = ((state.seed?.automationRules as AutomationRule[]) ?? []) as AutomationRule[];
    return createPortal(<Automation automationRules={automationRules} />, mount);
  }

  return null;
}
