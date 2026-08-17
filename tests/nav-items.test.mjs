import assert from "node:assert/strict";
import test from "node:test";
import { NAV_ITEMS } from "../app/crm/shell/nav-items.ts";
import { VIEW_REGISTRY } from "../app/crm/shell/view-registry.ts";

// Step 5 of the app.js decomposition (see CLAUDE.md): app/crm/shell/nav-items.ts
// is the single source of truth for the sidebar, replacing seven
// hand-written JSX buttons plus five injected at runtime by
// app/crm/legacy-app.js's initCrmApp() (that whole monolith is gone now -
// Phase 2, CLAUDE.md - along with the render-snapshot suite that used to
// be the only other coverage of nav order; this file is the sole remaining
// nav-order/registry coverage, unaffected by that deletion since it never
// depended on the sandbox harness Phase 2 removed).
//
// VIEW_REGISTRY (app/crm/shell/view-registry.ts) is a plain, DOM-free data
// module now - every one of this file's tests imports it directly, no
// sandbox/app boot required. It used to also carry a `react`/`render`
// distinction (legacy-rendered vs. React-hosted); that's gone too (Phase
// 2's own view-registry.ts header explains why) - every entry is just
// { showStatusFilter, showBatchFilter } now.
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

test("VIEW_REGISTRY has exactly the same set of view ids as NAV_ITEMS - no nav button without a registry entry, no registry entry without a nav button", () => {
  const registryIds = new Set(Object.keys(VIEW_REGISTRY));
  const navIds = new Set(NAV_ITEMS.map((item) => item.id));
  assert.deepEqual(registryIds, navIds);
});

test("every VIEW_REGISTRY entry has explicit boolean showStatusFilter/showBatchFilter flags", () => {
  for (const [id, entry] of Object.entries(VIEW_REGISTRY)) {
    assert.equal(typeof entry.showStatusFilter, "boolean", `${id}'s registry entry is missing showStatusFilter`);
    assert.equal(typeof entry.showBatchFilter, "boolean", `${id}'s registry entry is missing showBatchFilter`);
  }
});

test("exactly queue/print/qa/packet/bins show the batch filter, and only queue shows the status filter - preserving the shell's pre-Phase-2 conditionals", () => {
  const batchFilterViews = Object.entries(VIEW_REGISTRY)
    .filter(([, entry]) => entry.showBatchFilter)
    .map(([id]) => id)
    .sort();
  const statusFilterViews = Object.entries(VIEW_REGISTRY)
    .filter(([, entry]) => entry.showStatusFilter)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(batchFilterViews, ["bins", "packet", "print", "qa", "queue"]);
  assert.deepEqual(statusFilterViews, ["queue"]);
});
