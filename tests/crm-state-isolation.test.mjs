import assert from "node:assert/strict";
import test from "node:test";
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// Locks in the hazard step 4 of the app.js decomposition (CLAUDE.md) was
// built around: lib/client/crm-state.ts exports a createCrmState() factory,
// not a module-level singleton, specifically so a fresh cache-busted import
// of app/crm/legacy-app.js (what loadAppJsSandbox() does for every snapshot
// case - see tests/e2e-helpers.mjs) really does get its own state object,
// not one shared with every other "fresh" sandbox. A module-level singleton
// in crm-state.ts would break this silently: caseState() in
// tests/render-snapshots.test.mjs assigns every field it knows about via
// Object.assign, so leaked state could still produce a passing suite while
// the isolation itself was gone - this test exists so that regression can't
// hide behind a green render-snapshots run.
test("two sandboxes from loadAppJsSandbox() have genuinely independent state objects", async () => {
  const first = await loadAppJsSandbox();
  const second = await loadAppJsSandbox();
  assert.notEqual(first.state, second.state, "state must be a distinct object per sandbox/import, not a shared singleton");
});

test("mutating one sandbox's state does not leak into a second, later-created sandbox", async () => {
  const first = await loadAppJsSandbox();
  first.state.query = "mutated-in-first-sandbox";
  first.state.statusFilter = "Mailed";
  first.state.statusOverrides["m1::2"] = "Mailed";
  first.state.componentOverrides["m1::2::envelope"] = "Printed";
  first.state.reviewed.add("some-reviewed-key");

  const second = await loadAppJsSandbox();
  assert.equal(second.state.query, "", "second sandbox's query must be the fresh default, not the first sandbox's mutation");
  assert.equal(second.state.statusFilter, "Open", "second sandbox's statusFilter must be the fresh default");
  assert.deepEqual(second.state.statusOverrides, {}, "second sandbox's statusOverrides must be a fresh object");
  assert.deepEqual(second.state.componentOverrides, {}, "second sandbox's componentOverrides must be a fresh object");
  assert.equal(second.state.reviewed.has("some-reviewed-key"), false, "second sandbox's reviewed set must not see the first sandbox's addition");
  assert.equal(second.state.reviewed.size, 0, "second sandbox's reviewed set must be empty, not shared with the first");
});

test("isolation is symmetric: mutating a second sandbox does not retroactively affect the first", async () => {
  const first = await loadAppJsSandbox();
  first.state.query = "set-on-first";

  const second = await loadAppJsSandbox();
  second.state.query = "set-on-second";

  assert.equal(first.state.query, "set-on-first", "the first sandbox's own mutation must survive a second sandbox being created and mutated afterward");
  assert.equal(second.state.query, "set-on-second");
});
