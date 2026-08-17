import assert from "node:assert/strict";
import test from "node:test";
import { formatSaveFailureBannerHtml } from "../app/crm/shell/banners.ts";
import { createSaveFailureStore } from "../lib/client/save-failures.ts";

// Drives the real pipeline this feature adds end to end, minus the actual
// DOM write: a SaveFailureStore (lib/client/save-failures.ts) mutated
// directly (recordSaveFailure/recordSaveSuccess/recordLoadFailure) ->
// formatSaveFailureBannerHtml() (app/crm/shell/banners.ts), asserted on the
// returned HTML string directly. Before Phase 2 (the app.js decomposition's
// monolith deletion - CLAUDE.md), this had to go through
// tests/e2e-helpers.mjs's loadAppJsSandbox() and read back
// #saveFailureBanner's captured innerHTML, because
// app/crm/legacy-app.js's renderSaveFailureBanner() mixed the copy/
// formatting logic with the actual DOM write. Splitting the pure half out
// (app/crm/shell/banners.ts's own header explains why) means every test
// here needs neither a DOM stub nor updateMailingStatus/a real POST at
// all - just a store and the formatter. app/crm/shell/init-crm-app.ts's
// own thin DOM-writing wrapper (subscribed to this same store) is what
// still needs a real element to write into - not covered here, since
// nothing about ITS correctness is in question once the formatter itself
// is proven right.
function mailing(sourceRow) {
  return { mailingId: "MAIL-1", sourceRow };
}

test("no failures: the formatter renders nothing", () => {
  const store = createSaveFailureStore();
  assert.equal(formatSaveFailureBannerHtml(store.getSnapshot()), "");
});

test("a single failed save: singular wording, counted as one, includes the server's message, and gives HTTP-rejection guidance (not connectivity advice)", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "Row not found", "http");

  const html = formatSaveFailureBannerHtml(store.getSnapshot());
  // The banner HTML-escapes its text (escapeHtml), so a literal "'" in the
  // rendered wording comes back as "&#039;" - matched here without the
  // apostrophe rather than against the escaped entity, so this test isn't
  // coupled to escapeHtml's specific entity choice.
  assert.match(html, /1 change couldn.{1,8}t be saved/);
  assert.match(html, /It only exists on this device/);
  assert.match(html, /reloading this page will lose it/);
  assert.doesNotMatch(html, /changes couldn.{1,8}t be saved/, "must use singular \"change\", not plural, for a count of one");
  assert.match(html, /The server refused it/);
  assert.doesNotMatch(html, /once you.{1,8}re back online/, "an HTTP rejection must not get network-outage guidance");
  assert.match(html, /Row not found/, "the server's own message should be included");
});

test("many failed saves (bulk-action shape): plural wording, one counted message, not enumerated, HTTP-rejection guidance", () => {
  const store = createSaveFailureStore();
  for (let i = 0; i < 120; i += 1) {
    store.recordSaveFailure("mailingStatus", mailing(i).mailingId, "Row not found", "http");
  }

  const html = formatSaveFailureBannerHtml(store.getSnapshot());
  assert.match(html, /120 changes couldn.{1,8}t be saved/);
  assert.match(html, /They only exist on this device/);
  assert.match(html, /reloading this page will lose them/);
  assert.match(html, /The server refused the most recent one/);
  assert.doesNotMatch(html, /once you.{1,8}re back online/, "an HTTP rejection must not get network-outage guidance");
  // Counted, not enumerated: exactly one <p> for the save-failure message,
  // not one per failed call.
  assert.equal((html.match(/<p>/g) || []).length, 1);
});

test("a network failure (as opposed to an HTTP rejection) gets connectivity guidance, not \"the server refused it\"", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "Could not reach the server - check your connection.", "network");

  const html = formatSaveFailureBannerHtml(store.getSnapshot());
  assert.match(html, /1 change couldn.{1,8}t be saved/);
  assert.match(html, /Re-apply it once you.{1,8}re back online/);
  assert.doesNotMatch(html, /The server refused/, "a network failure must not get HTTP-rejection guidance");
});

test("a later successful save does not clear an existing failure banner", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "Row not found", "http");
  store.recordSaveFailure("mailingStatus", "MAIL-2::2", "Row not found", "http");
  assert.match(formatSaveFailureBannerHtml(store.getSnapshot()), /2 changes couldn.{1,8}t be saved/);

  store.recordSaveSuccess("mailingStatus", "MAIL-1::3");

  const html = formatSaveFailureBannerHtml(store.getSnapshot());
  assert.match(html, /2 changes couldn.{1,8}t be saved/, "a success must not reduce the failure count");
});

test("a failed initial load renders the distinct load-failure state, not folded into the save-failure count", () => {
  const store = createSaveFailureStore();
  store.recordLoadFailure("Could not load shared CRM state.");

  const html = formatSaveFailureBannerHtml(store.getSnapshot());
  assert.match(html, /Couldn.{1,8}t load the shared data from the server/);
  assert.match(html, /Could not load shared CRM state\./);
  assert.doesNotMatch(html, /couldn.{1,8}t be saved/, "a load failure must not use save-failure wording");
});

test("a save failure and a load failure can both be visible in the banner at once", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "Row not found", "http");
  store.recordLoadFailure("Could not load shared CRM state.");

  const html = formatSaveFailureBannerHtml(store.getSnapshot());
  assert.match(html, /1 change couldn.{1,8}t be saved/);
  assert.match(html, /Couldn.{1,8}t load the shared data from the server/);
  assert.equal((html.match(/<p>/g) || []).length, 2, "one paragraph per distinct failure state");
});

test("a clean store (no failures recorded at all) renders nothing, confirming the empty state is the true default, not an untested assumption", () => {
  const store = createSaveFailureStore();
  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot, {
    failedSaveCount: 0,
    lastFailureMessage: null,
    lastFailureCause: null,
    loadFailed: false,
    loadFailureMessage: null,
  });
  assert.equal(formatSaveFailureBannerHtml(snapshot), "");
});
