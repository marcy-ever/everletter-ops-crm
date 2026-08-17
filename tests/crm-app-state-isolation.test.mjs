import assert from "node:assert/strict";
import test from "node:test";
import { createAppState } from "../app/crm/shell/crm-app-state.ts";

// Locks in the hazard step 4 of the app.js decomposition (CLAUDE.md) was
// built around, still real after Phase 2 deleted the monolith that hazard
// was first framed against: lib/client/crm-state.ts exports a
// createCrmState() factory, not a module-level singleton, and
// app/crm/shell/crm-app-state.ts's createAppState() (which bundles it with
// createSaveFailureStore()/createStalenessStore()) is a factory for the
// identical reason - eleven e2e write-path test files each need a fresh,
// isolated instance so one test's writes can't leak into another's.
//
// Before Phase 2, that isolation came from tests/e2e-helpers.mjs's
// loadAppJsSandbox() forcing a fresh dynamic import() of the whole
// legacy-app.js module (a `?t=<counter>` cache-buster) - the only way to
// get a "fresh module instance" when the factory call lived at that
// module's own top level with no way to invoke it a second time from
// outside. That harness is gone (deleted with legacy-app.js itself), but
// the property it guarded - createAppState() actually producing
// independent instances, not a shared singleton - still matters exactly as
// much, so this test moved with it rather than being deleted alongside the
// harness. A module-level singleton snuck into createAppState() (or
// createCrmState()/createSaveFailureStore()/createStalenessStore()
// underneath it) would break this silently: every e2e write-path test's
// own per-test setup assigns most fields it cares about explicitly, so
// leaked state could still produce a passing suite while the isolation
// itself was gone.
test("two instances from createAppState() have genuinely independent state objects", () => {
  const first = createAppState();
  const second = createAppState();
  assert.notEqual(first.state, second.state, "state must be a distinct object per createAppState() call, not a shared singleton");
});

test("mutating one instance's state does not leak into a second, later-created instance", () => {
  const first = createAppState();
  first.state.query = "mutated-in-first-instance";
  first.state.statusFilter = "Mailed";
  first.state.statusOverrides["m1::2"] = "Mailed";
  first.state.componentOverrides["m1::2::envelope"] = "Printed";
  first.state.reviewed.add("some-reviewed-key");

  const second = createAppState();
  assert.equal(second.state.query, "", "second instance's query must be the fresh default, not the first instance's mutation");
  assert.equal(second.state.statusFilter, "Open", "second instance's statusFilter must be the fresh default");
  assert.deepEqual(second.state.statusOverrides, {}, "second instance's statusOverrides must be a fresh object");
  assert.deepEqual(second.state.componentOverrides, {}, "second instance's componentOverrides must be a fresh object");
  assert.equal(second.state.reviewed.has("some-reviewed-key"), false, "second instance's reviewed set must not see the first instance's addition");
  assert.equal(second.state.reviewed.size, 0, "second instance's reviewed set must be empty, not shared with the first");
});

test("isolation is symmetric: mutating a second instance does not retroactively affect the first", () => {
  const first = createAppState();
  first.state.query = "set-on-first";

  const second = createAppState();
  second.state.query = "set-on-second";

  assert.equal(first.state.query, "set-on-first", "the first instance's own mutation must survive a second instance being created and mutated afterward");
  assert.equal(second.state.query, "set-on-second");
});

test("saveFailures and staleness are also distinct instances, not shared - writes to one instance's stores don't affect another's", () => {
  const first = createAppState();
  const second = createAppState();

  first.saveFailures.recordSaveFailure("mailingStatus", "MAIL-1::2", "simulated failure", "network");
  first.staleness.recordServerMarker(5);

  assert.equal(second.saveFailures.getSnapshot().failedSaveCount, 0, "a failure recorded on the first instance's store must not appear on the second's");
  assert.equal(second.staleness.getSnapshot().serverMarker, null, "a marker recorded on the first instance's store must not appear on the second's");
});
