import assert from "node:assert/strict";
import test from "node:test";
import { MAILING_STATUSES } from "../lib/domain/mailing-rules.ts";
import { COMPONENT_FIELD_OPTIONS } from "../lib/domain/component-fields.ts";
import { QA_FIELDS } from "../app/crm/views/qa/qa-selectors.ts";
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// A real, live duplication - not the ids/keys/mailing-rules kind step 3a
// eliminated (see tests/ids.test.mjs's module comment for why those
// became format-locking tests instead of parity tests: legacy-app.js
// imports lib/domain/ directly for those now, so there's nothing left to
// diff). lib/domain/mailing-rules.ts's MAILING_STATUSES and
// lib/domain/component-fields.ts's COMPONENT_FIELD_OPTIONS are hand-
// transcribed copies of app/crm/legacy-app.js's statusOrder and (until
// step 14 - Mailing QA, CLAUDE.md - moved it to
// app/crm/views/qa/qa-selectors.ts's QA_FIELDS along with the view that
// owns it) legacy's own qaFields, added for POST /api/shared-state's
// server-side validation (lib/validate-shared-state.ts) without wiring
// legacy-app.js/QA_FIELDS to import them - a deliberate scope decision
// (server-validation-only), not an oversight, but one that leaves two
// real, independently-maintained copies with nothing detecting drift
// between them.
//
// The failure mode if they drift is user-facing and silent: add a status
// option to a <select> in legacy-app.js or Qa.tsx, forget the matching
// update here, and a save that looks completely legitimate in the UI
// starts getting rejected with a 400 - invisibly, because
// saveSharedState() (lib/client/shared-state-client.ts) swallows the
// failure.
//
// statusOrder's own check still follows the sandbox-load-and-diff pattern
// tests/ids.test.mjs/tests/keys.test.mjs used before step 3a (statusOrder
// itself hasn't moved out of legacy-app.js - Batch Print/Bins/Packet all
// still read it). QA_FIELDS is a plain TS module export now, so its check
// imports directly instead - no sandbox load needed for that half.
test("MAILING_STATUSES (lib/domain/mailing-rules.ts) matches app/crm/legacy-app.js's statusOrder exactly", async () => {
  const appJs = await loadAppJsSandbox();
  assert.deepEqual(MAILING_STATUSES, appJs.statusOrder);
});

test("COMPONENT_FIELD_OPTIONS (lib/domain/component-fields.ts) matches app/crm/views/qa/qa-selectors.ts's QA_FIELDS exactly - every field, every option, same order", () => {
  const fromQaFields = Object.fromEntries(QA_FIELDS.map((field) => [field.key, field.options]));
  assert.deepEqual(COMPONENT_FIELD_OPTIONS, fromQaFields);
});

test("COMPONENT_FIELD_OPTIONS and QA_FIELDS have the same set of field keys, not just matching values for the keys both happen to have", () => {
  const qaFieldsKeys = new Set(QA_FIELDS.map((field) => field.key));
  const domainKeys = new Set(Object.keys(COMPONENT_FIELD_OPTIONS));
  assert.deepEqual(domainKeys, qaFieldsKeys);
});
