import assert from "node:assert/strict";
import test from "node:test";
import { MAILING_STATUSES } from "../lib/domain/mailing-rules.ts";
import { COMPONENT_FIELD_OPTIONS } from "../lib/domain/component-fields.ts";
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// A real, live duplication - not the ids/keys/mailing-rules kind step 3a
// eliminated (see tests/ids.test.mjs's module comment for why those
// became format-locking tests instead of parity tests: legacy-app.js
// imports lib/domain/ directly for those now, so there's nothing left to
// diff). lib/domain/mailing-rules.ts's MAILING_STATUSES and
// lib/domain/component-fields.ts's COMPONENT_FIELD_OPTIONS are hand-
// transcribed copies of app/crm/legacy-app.js's statusOrder/qaFields,
// added for POST /api/shared-state's server-side validation
// (lib/validate-shared-state.ts) without wiring legacy-app.js to import
// them - a deliberate scope decision (server-validation-only), not an
// oversight, but one that leaves two real, independently-maintained
// copies with nothing detecting drift between them.
//
// The failure mode if they drift is user-facing and silent: add a status
// option to a <select> in legacy-app.js, forget the matching update
// here, and a save that looks completely legitimate in the UI starts
// getting rejected with a 400 - invisibly, because saveSharedState()
// (lib/client/shared-state-client.ts) swallows the failure.
//
// This follows the same sandbox-load-and-diff pattern
// tests/ids.test.mjs/tests/keys.test.mjs used before step 3a: load the
// real app/crm/legacy-app.js, read its real statusOrder/qaFields, and
// assert they match lib/domain/'s copies exactly - not by eye, and not
// assumed to still hold just because it held when this test was written.
test("MAILING_STATUSES (lib/domain/mailing-rules.ts) matches app/crm/legacy-app.js's statusOrder exactly", async () => {
  const appJs = await loadAppJsSandbox();
  assert.deepEqual(MAILING_STATUSES, appJs.statusOrder);
});

test("COMPONENT_FIELD_OPTIONS (lib/domain/component-fields.ts) matches app/crm/legacy-app.js's qaFields exactly - every field, every option, same order", async () => {
  const appJs = await loadAppJsSandbox();
  const fromAppJs = Object.fromEntries(appJs.qaFields.map((field) => [field.key, field.options]));
  assert.deepEqual(COMPONENT_FIELD_OPTIONS, fromAppJs);
});

test("COMPONENT_FIELD_OPTIONS and qaFields have the same set of field keys, not just matching values for the keys both happen to have", async () => {
  const appJs = await loadAppJsSandbox();
  const appJsKeys = new Set(appJs.qaFields.map((field) => field.key));
  const domainKeys = new Set(Object.keys(COMPONENT_FIELD_OPTIONS));
  assert.deepEqual(domainKeys, appJsKeys);
});
