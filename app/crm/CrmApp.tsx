"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { todayIso } from "@/lib/domain/mailing-rules";
import { effectiveMailings } from "@/lib/client/selectors";
import { initCrmApp, state, subscribeViewChanged, VIEW_REGISTRY } from "./legacy-app.js";
import Automation from "./views/Automation";
import type { AutomationRule } from "./views/Automation";
import LaunchPlan from "./views/launch-plan/LaunchPlan";
import { computeLaunchPlanData } from "./views/launch-plan/launch-selectors";

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
// REACT_VIEWS (added in step 7, alongside Launch Plan) is the same lesson
// this codebase already learned once, one layer over: step 5 replaced
// renderView()'s per-view if-chain with VIEW_REGISTRY once enough legacy
// views existed that the chain was real, not speculative, duplication.
// Two React-hosted views is exactly that same moment for this dispatch -
// a second `if (activeView === "launch") {...}` here would be the
// beginning of the identical chain, so it's a lookup table from the
// start instead. Each entry computes its own props from `state` (the
// single explicit place `new Date()` is ever called for a migrated view -
// see launch-selectors.ts's own header on why the view itself never
// reaches for the clock) and returns the element to portal.
//
// Guards on `state.seed` being non-null for views that need real data:
// Automation degrades gracefully with an empty rules array (its 7 static
// flow steps still render), but Launch Plan's computation does real
// property access on `seed` and has no sensible "empty" rendering to
// fall back to - and neither legacy views nor Automation actually show
// anything before state.seed loads either (nothing calls render() until
// then), so "render nothing yet" is the existing behavior, not a new one.
const REACT_VIEWS: Record<string, () => ReactNode> = {
  automation: () => {
    const automationRules = (state.seed?.automationRules as AutomationRule[] | undefined) ?? [];
    return <Automation automationRules={automationRules} />;
  },
  launch: () => {
    if (!state.seed) return null;
    const data = computeLaunchPlanData(
      state.seed,
      effectiveMailings(state.seed, state.statusOverrides),
      state.reviewed,
      state.componentOverrides,
      state.batchFilter,
      state.packetScope,
      state.query,
      todayIso(new Date()),
    );
    return <LaunchPlan data={data} />;
  },
};

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
  const renderReactView = REACT_VIEWS[activeView];
  if (!entry?.react || !renderReactView) return null;

  return createPortal(renderReactView(), mount);
}
