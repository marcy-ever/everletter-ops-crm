"use client";

import { useEffect } from "react";
import { initCrmApp } from "./legacy-app.js";

// Mounts the legacy CRM monolith into the DOM markup app/page.tsx already
// renders (#viewMount, #topbarMeta, the side-nav buttons, etc.) instead of
// loading it as a separate <Script> tag. initCrmApp() only touches
// document/window/localStorage, never React state, so this component has
// nothing to render itself - it's a mount trigger, not a view.
//
// Runs inside a browser-only effect specifically so nothing in legacy-app.js
// executes during SSR, where document/window/localStorage don't exist (a
// "use client" component's render still runs once on the server to produce
// the initial HTML - only its effects are browser-only). initCrmApp() itself
// guards against being called twice, which covers React StrictMode
// double-invoking effects in development.
//
// Not yet built: the seam that would let this component host a migrated
// React view (e.g. Automation) alongside legacy-app.js's remaining render
// functions, switching on state.activeView the same way
// app/crm/legacy-app.js's VIEW_REGISTRY does. Deliberately deferred to step
// 6, where the Automation view gives it one real, tiny consumer to design
// against, instead of building it now with zero migrated views to prove it
// against - see CLAUDE.md's decomposition plan.
export default function CrmApp() {
  useEffect(() => {
    initCrmApp();
  }, []);

  return null;
}
