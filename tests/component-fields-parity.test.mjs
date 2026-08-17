import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_FIELD_OPTIONS } from "../lib/domain/component-fields.ts";
import { QA_FIELDS } from "../app/crm/views/qa/qa-selectors.ts";

// A real, live duplication - not the ids/keys/mailing-rules kind step 3a
// eliminated (see tests/ids.test.mjs's module comment for why those
// became format-locking tests instead of parity tests). lib/domain/
// component-fields.ts's COMPONENT_FIELD_OPTIONS is a hand-transcribed
// copy of (until step 14 - Mailing QA, CLAUDE.md - moved it to
// app/crm/views/qa/qa-selectors.ts's QA_FIELDS along with the view that
// owns it) legacy's own qaFields, added for POST /api/shared-state's
// server-side validation (lib/validate-shared-state.ts) without wiring
// QA_FIELDS to import it - a deliberate scope decision
// (server-validation-only), not an oversight, but one that leaves two
// real, independently-maintained copies with nothing detecting drift
// between them.
//
// The failure mode if they drift is user-facing and silent: add a status
// option to Qa.tsx's <select>, forget the matching update here, and a save
// that looks completely legitimate in the UI starts getting rejected with
// a 400 - invisibly, because saveSharedState() (lib/client/shared-state-client.ts)
// swallows the failure.
//
// This file used to also parity-check lib/domain/mailing-rules.ts's
// MAILING_STATUSES against app/crm/legacy-app.js's own statusOrder - that
// second copy is gone (Phase 2, CLAUDE.md, the monolith's deletion):
// app/crm/shell/render-shell.ts's replacement for legacy's renderShell()
// imports MAILING_STATUSES directly instead of keeping its own
// independently-maintained list, closing the duplication rather than just
// detecting it. Nothing left to diff, so that test is gone too, not moved.
test("COMPONENT_FIELD_OPTIONS (lib/domain/component-fields.ts) matches app/crm/views/qa/qa-selectors.ts's QA_FIELDS exactly - every field, every option, same order", () => {
  const fromQaFields = Object.fromEntries(QA_FIELDS.map((field) => [field.key, field.options]));
  assert.deepEqual(COMPONENT_FIELD_OPTIONS, fromQaFields);
});

test("COMPONENT_FIELD_OPTIONS and QA_FIELDS have the same set of field keys, not just matching values for the keys both happen to have", () => {
  const qaFieldsKeys = new Set(QA_FIELDS.map((field) => field.key));
  const domainKeys = new Set(Object.keys(COMPONENT_FIELD_OPTIONS));
  assert.deepEqual(domainKeys, qaFieldsKeys);
});
