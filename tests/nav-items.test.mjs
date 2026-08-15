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

test("every VIEW_REGISTRY entry has a render function and explicit filter-visibility flags", async () => {
  const appJs = await loadAppJsSandbox();
  for (const [id, entry] of Object.entries(appJs.VIEW_REGISTRY)) {
    assert.equal(typeof entry.render, "function", `${id}'s registry entry is missing a render function`);
    assert.equal(typeof entry.showStatusFilter, "boolean", `${id}'s registry entry is missing showStatusFilter`);
    assert.equal(typeof entry.showBatchFilter, "boolean", `${id}'s registry entry is missing showBatchFilter`);
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
