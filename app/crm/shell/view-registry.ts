/**
 * Which of the two shell filter controls (search's neighbors - Status and
 * Batch) each view shows. Used to be app/crm/legacy-app.js's VIEW_REGISTRY,
 * which also named a `render` function per view (legacy-rendered) or
 * carried `react: true` (React-hosted, app/crm/CrmApp.tsx's REACT_VIEWS) -
 * that distinction is gone in Phase 2 (the app.js decomposition's monolith
 * deletion - CLAUDE.md): every view is react-hosted now, has been since
 * step 17 merged, and legacy-app.js itself no longer exists. A field with
 * exactly one value across every entry is noise, not a real distinction -
 * dropped rather than kept for its own sake. CrmApp.tsx's dispatch no
 * longer reads this object at all; it just checks whether REACT_VIEWS has
 * an entry for the active view.
 *
 * Kept in agreement with app/crm/shell/nav-items.ts's id list by
 * tests/nav-items.test.mjs - no nav button without a registry entry, no
 * registry entry without a nav button. Both files are now plain, DOM-free
 * data modules, so that test imports this one directly - no sandbox, no
 * app boot required to check the invariant.
 */

export interface ViewRegistryEntry {
  showStatusFilter: boolean;
  showBatchFilter: boolean;
}

export const VIEW_REGISTRY: Record<string, ViewRegistryEntry> = {
  queue: { showStatusFilter: true, showBatchFilter: true },
  exceptions: { showStatusFilter: false, showBatchFilter: false },
  subscribers: { showStatusFilter: false, showBatchFilter: false },
  samples: { showStatusFilter: false, showBatchFilter: false },
  import: { showStatusFilter: false, showBatchFilter: false },
  print: { showStatusFilter: false, showBatchFilter: true },
  qa: { showStatusFilter: false, showBatchFilter: true },
  packet: { showStatusFilter: false, showBatchFilter: true },
  bins: { showStatusFilter: false, showBatchFilter: true },
  launch: { showStatusFilter: false, showBatchFilter: false },
  sync: { showStatusFilter: false, showBatchFilter: false },
  automation: { showStatusFilter: false, showBatchFilter: false },
};
