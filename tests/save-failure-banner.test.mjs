import assert from "node:assert/strict";
import test from "node:test";
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// Drives the real pipeline this task adds end to end: a mutator in
// lib/client/crm-state.ts (updateMailingStatus) -> saveSharedState()
// (lib/client/shared-state-client.ts) -> the SaveFailureStore
// (lib/client/save-failures.ts, exported from app/crm/legacy-app.js as
// `saveFailures` for exactly this purpose) -> renderSaveFailureBanner(),
// subscribed in initCrmApp() -> #saveFailureBanner's real innerHTML, read
// back via loadAppJsSandbox's captureRenders/getCapturedHtml (the same
// mechanism tests/render-snapshots.test.mjs already trusts for #viewMount).
//
// globalThis.fetch is stubbed unconditionally by loadAppJsSandbox() to
// `async () => ({ ok: false, json: async () => ({}) })` - every save in
// this file therefore fails, which is exactly the path under test. There's
// no way to drive a *successful* save through this sandbox (see that
// module's own comment), so "a successful save leaves the banner empty" is
// asserted directly against saveFailures/renderSaveFailureBanner instead of
// through a real fetch - see the last test below.
//
// saveSharedState's fetch chain resolves asynchronously (a .then off the
// fetch promise, itself awaiting response.json() inside readErrorMessage),
// so every call here needs to let a real macrotask turn pass before reading
// the banner - a fixed number of chained microtask awaits (Promise.resolve())
// undercounted the actual chain length and left the banner still empty at
// assertion time. Matches tests/shared-state-client-failures.test.mjs's own
// `setTimeout(resolve, 0)` wait for the same reason.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mailing(sourceRow) {
  return { mailingId: "MAIL-1", sourceRow };
}

test("no failures: the banner renders nothing", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  assert.equal(sandbox.getCapturedHtml("#saveFailureBanner"), "");
});

test("a single failed save: singular wording, counted as one, includes the server's message", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.updateMailingStatus(mailing(1), "Mailed");
  await flush();

  const html = sandbox.getCapturedHtml("#saveFailureBanner");
  // The banner HTML-escapes its text (escapeHtml), so a literal "'" in the
  // rendered wording comes back as "&#039;" - matched here without the
  // apostrophe rather than against the escaped entity, so this test isn't
  // coupled to escapeHtml's specific entity choice.
  assert.match(html, /1 change couldn.{1,8}t be saved/);
  assert.match(html, /It only exists on this device/);
  assert.match(html, /reloading this page will lose it/);
  assert.doesNotMatch(html, /changes couldn.{1,8}t be saved/, "must use singular \"change\", not plural, for a count of one");
});

test("many failed saves (bulk-action shape): plural wording, one counted message, not enumerated", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  for (let i = 0; i < 120; i += 1) {
    sandbox.updateMailingStatus(mailing(i), "Mailed");
  }
  await flush();

  const html = sandbox.getCapturedHtml("#saveFailureBanner");
  assert.match(html, /120 changes couldn.{1,8}t be saved/);
  assert.match(html, /They only exist on this device/);
  assert.match(html, /reloading this page will lose them/);
  // Counted, not enumerated: exactly one <p> for the save-failure message,
  // not one per failed call.
  assert.equal((html.match(/<p>/g) || []).length, 1);
});

test("a later successful save does not clear an existing failure banner", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.updateMailingStatus(mailing(1), "Mailed");
  sandbox.updateMailingStatus(mailing(2), "Mailed");
  await flush();
  assert.match(sandbox.getCapturedHtml("#saveFailureBanner"), /2 changes couldn.{1,8}t be saved/);

  // Simulate a success directly against the store (the sandbox's stubbed
  // fetch always fails - see the module comment above - so this is the only
  // way to exercise recordSaveSuccess()'s effect on the rendered banner
  // without a second, real-fetch-capable harness).
  sandbox.saveFailures.recordSaveSuccess("mailingStatus", "MAIL-1::3");

  const html = sandbox.getCapturedHtml("#saveFailureBanner");
  assert.match(html, /2 changes couldn.{1,8}t be saved/, "a success must not reduce the failure count");
});

test("a failed initial load renders the distinct load-failure state, not folded into the save-failure count", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.saveFailures.recordLoadFailure("Could not load shared CRM state.");

  const html = sandbox.getCapturedHtml("#saveFailureBanner");
  assert.match(html, /Couldn.{1,8}t load the shared data from the server/);
  assert.match(html, /Could not load shared CRM state\./);
  assert.doesNotMatch(html, /couldn.{1,8}t be saved/, "a load failure must not use save-failure wording");
});

test("a save failure and a load failure can both be visible in the banner at once", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.updateMailingStatus(mailing(1), "Mailed");
  await flush();
  sandbox.saveFailures.recordLoadFailure("Could not load shared CRM state.");

  const html = sandbox.getCapturedHtml("#saveFailureBanner");
  assert.match(html, /1 change couldn.{1,8}t be saved/);
  assert.match(html, /Couldn.{1,8}t load the shared data from the server/);
  assert.equal((html.match(/<p>/g) || []).length, 2, "one paragraph per distinct failure state");
});

test("a clean store (no failures recorded at all) renders nothing, confirming the empty state is the true default, not an untested assumption", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  const snapshot = sandbox.saveFailures.getSnapshot();
  assert.deepEqual(snapshot, {
    failedSaveCount: 0,
    lastFailureMessage: null,
    loadFailed: false,
    loadFailureMessage: null,
  });
  assert.equal(sandbox.getCapturedHtml("#saveFailureBanner"), "");
});
