import assert from "node:assert/strict";
import test from "node:test";
import { NAV_ITEMS } from "../app/crm/shell/nav-items.ts";
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// Step 5 of the app.js decomposition (see CLAUDE.md): app/crm/shell/nav-items.ts
// is now the single source of truth for the sidebar, replacing seven
// hand-written JSX buttons plus five injected at runtime by
// app/crm/legacy-app.js's initCrmApp(). The render-snapshot suite captures
// #viewMount only - it's blind to the sidebar entirely, so this file is the
// only real coverage of nav order and of the nav/registry invariant.
//
// The exact order below was verified against the pre-change injection
// logic by mechanically simulating it (not assumed from the task prompt
// that requested this step) - see this step's PR description for the
// simulation. It matches this list exactly.
const EXPECTED_ORDER = [
  "queue",
  "exceptions",
  "subscribers",
  "samples",
  "import",
  "print",
  "qa",
  "packet",
  "bins",
  "launch",
  "sync",
  "automation",
];

test("NAV_ITEMS contains exactly twelve views, in the exact pre-change order", () => {
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.id),
    EXPECTED_ORDER,
  );
});

test("NAV_ITEMS has no duplicate ids", () => {
  const ids = NAV_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every NAV_ITEMS entry has a non-empty badge and label", () => {
  for (const item of NAV_ITEMS) {
    assert.ok(item.badge, `${item.id} is missing a badge`);
    assert.ok(item.label, `${item.id} is missing a label`);
  }
});

test("app/crm/legacy-app.js's VIEW_REGISTRY has exactly the same set of view ids as NAV_ITEMS - no nav button without a renderer, no renderer without a nav button", async () => {
  const appJs = await loadAppJsSandbox();
  const registryIds = new Set(Object.keys(appJs.VIEW_REGISTRY));
  const navIds = new Set(NAV_ITEMS.map((item) => item.id));
  assert.deepEqual(registryIds, navIds);
});

// As of Phase 1's first migrated view (step 6 - CLAUDE.md), a registry
// entry is EITHER legacy-rendered (a `render` function, dispatched by
// app/crm/legacy-app.js's renderView()) OR React-hosted (`react: true`,
// dispatched by app/crm/CrmApp.tsx's portal seam) - never both, never
// neither. Both shapes still carry explicit filter-visibility flags; the
// registry stays the one place that answers "does this view show the
// status/batch filter," regardless of who renders its content.
test("every VIEW_REGISTRY entry is either legacy-rendered or react-hosted (never both, never neither), and has explicit filter-visibility flags", async () => {
  const appJs = await loadAppJsSandbox();
  for (const [id, entry] of Object.entries(appJs.VIEW_REGISTRY)) {
    const isLegacy = typeof entry.render === "function";
    const isReact = entry.react === true;
    assert.ok(isLegacy || isReact, `${id}'s registry entry must have a render function or be marked react-hosted`);
    assert.ok(!(isLegacy && isReact), `${id}'s registry entry must not be both legacy-rendered and react-hosted`);
    assert.equal(typeof entry.showStatusFilter, "boolean", `${id}'s registry entry is missing showStatusFilter`);
    assert.equal(typeof entry.showBatchFilter, "boolean", `${id}'s registry entry is missing showBatchFilter`);
  }
});

test("automation and launch are the react-hosted views so far, and carry no legacy render function", async () => {
  const appJs = await loadAppJsSandbox();
  for (const id of ["automation", "launch"]) {
    assert.equal(appJs.VIEW_REGISTRY[id].react, true, `${id} should be react-hosted`);
    assert.equal(appJs.VIEW_REGISTRY[id].render, undefined, `${id} should carry no legacy render function`);
  }
  // Every other view is still legacy-rendered - a control, so this test
  // can't pass by accident if some future change marks everything react.
  const stillLegacy = Object.entries(appJs.VIEW_REGISTRY).filter(([id]) => id !== "automation" && id !== "launch");
  assert.equal(stillLegacy.length, 10);
  for (const [id, entry] of stillLegacy) {
    assert.equal(typeof entry.render, "function", `${id} should still be legacy-rendered`);
  }
});

test("exactly queue/print/qa/packet/bins show the batch filter, and only queue shows the status filter - preserving renderView()'s pre-change conditionals", async () => {
  const appJs = await loadAppJsSandbox();
  const batchFilterViews = Object.entries(appJs.VIEW_REGISTRY)
    .filter(([, entry]) => entry.showBatchFilter)
    .map(([id]) => id)
    .sort();
  const statusFilterViews = Object.entries(appJs.VIEW_REGISTRY)
    .filter(([, entry]) => entry.showStatusFilter)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(batchFilterViews, ["bins", "packet", "print", "qa", "queue"]);
  assert.deepEqual(statusFilterViews, ["queue"]);
});
