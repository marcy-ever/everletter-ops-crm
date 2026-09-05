/**
 * The single source of truth for the sidebar: every view's id, badge, and
 * label, in the order they appear. Step 5 of the app.js decomposition (see
 * CLAUDE.md) - before this, seven of these were declared in app/page.tsx's
 * JSX and the other five (qa/packet/bins/launch/samples) were injected at
 * runtime by app/crm/legacy-app.js via insertAdjacentHTML, each positioned
 * relative to an existing button. Nobody reading page.tsx alone could tell
 * what the sidebar actually contained.
 *
 * This order was verified, not assumed, against the pre-change injection
 * logic (see this step's PR description for the mechanical trace) - it is
 * exactly what shipped before, not a guess at what it should be.
 *
 * `id` matches a view's `data-view` attribute and its key in
 * app/crm/shell/view-registry.ts's VIEW_REGISTRY - never rename these,
 * they're persisted in window.location.hash and users have bookmarks.
 * tests/nav-items.test.mjs locks both the exact id set and this exact
 * order; a second test asserts this set matches VIEW_REGISTRY's keys
 * exactly, so a view can never have a nav button without a registry entry
 * or a registry entry without a nav button.
 */

export interface NavItem {
  id: string;
  badge: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "queue", badge: "Q", label: "Production Queue" },
  { id: "exceptions", badge: "!", label: "Needs Review" },
  { id: "subscribers", badge: "S", label: "Subscribers" },
  { id: "samples", badge: "@", label: "Sample Requests" },
  { id: "import", badge: "U", label: "Import Sheet" },
  { id: "print", badge: "P", label: "Batch Print" },
  { id: "qa", badge: "QA", label: "Mailing QA" },
  { id: "packet", badge: "B", label: "Batch Packet" },
  { id: "bins", badge: "N", label: "Ashley Bins" },
  { id: "launch", badge: "L", label: "Launch Plan" },
  { id: "sync", badge: "Y", label: "Squarespace Orders" },
  { id: "automation", badge: "A", label: "Automation Map" },
];
