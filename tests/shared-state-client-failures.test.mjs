import assert from "node:assert/strict";
import test from "node:test";
import { saveSharedState, loadSharedState } from "../lib/client/shared-state-client.ts";
import { createSaveFailureStore } from "../lib/client/save-failures.ts";

// Direct unit coverage of the HTTP-to-store wiring this task adds:
// saveSharedState/loadSharedState now check response.ok and report every
// outcome (network failure, HTTP failure with a server message, success)
// to a SaveFailureStore, instead of a network failure being silently
// swallowed and an HTTP failure being ignored outright (no response.ok
// check existed at all before this). Mocks globalThis.fetch directly -
// no sandbox, no DOM - since neither function touches anything else.
const realFetch = globalThis.fetch;
function mockFetch(impl) {
  globalThis.fetch = impl;
}
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// loadSharedState's success path writes through to
// lib/client/local-overrides.ts, which touches the bare `localStorage`
// global - present in a real browser (and stubbed by
// tests/shell-test-helpers.mjs's installLocalStorageStub() for tests that
// use it) but not in a plain node:test run. Stubbed the same minimal way
// here directly since this file deliberately runs without that helper.
globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// --- saveSharedState ---

test("saveSharedState records a save failure with the server's error message on a 400", async () => {
  mockFetch(async () => jsonResponse(400, { error: '"Not A Real Status" is not a valid mailing status.' }));
  const store = createSaveFailureStore();
  saveSharedState("mailingStatus", "MAIL-1::2", "Not A Real Status", store);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.failedSaveCount, 1);
  assert.equal(snapshot.lastFailureMessage, '"Not A Real Status" is not a valid mailing status.');
  assert.equal(snapshot.lastFailureCause, "http");
});

test("saveSharedState records a save failure with the server's 409 message (catastrophic-deletion guard)", async () => {
  mockFetch(async () => jsonResponse(409, { error: "This import contains 118 mailings and would remove 1,100 of 1,218 existing ones (90%), over the 60% threshold - refused." }));
  const store = createSaveFailureStore();
  saveSharedState("crmDataset", "current", "{}", store);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(store.getSnapshot().lastFailureMessage, "This import contains 118 mailings and would remove 1,100 of 1,218 existing ones (90%), over the 60% threshold - refused.");
  assert.equal(store.getSnapshot().lastFailureCause, "http");
});

test("saveSharedState falls back to a generic message when the error response has no usable body", async () => {
  mockFetch(async () => jsonResponse(500, {}));
  const store = createSaveFailureStore();
  saveSharedState("mailingStatus", "MAIL-1::2", "Mailed", store);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(store.getSnapshot().lastFailureMessage, /HTTP 500/);
  assert.equal(store.getSnapshot().lastFailureCause, "http");
});

test("saveSharedState records a save failure on a network error, distinct wording from an HTTP failure", async () => {
  mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const store = createSaveFailureStore();
  saveSharedState("mailingStatus", "MAIL-1::2", "Mailed", store);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.failedSaveCount, 1);
  assert.match(snapshot.lastFailureMessage, /reach the server/i);
  assert.equal(snapshot.lastFailureCause, "network", "distinct cause from an HTTP failure - the banner's guidance sentence branches on this");
});

test("saveSharedState records a success and does not increment the failure count", async () => {
  mockFetch(async () => jsonResponse(200, { ok: true }));
  const store = createSaveFailureStore();
  saveSharedState("mailingStatus", "MAIL-1::2", "Mailed", store);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(store.getSnapshot().failedSaveCount, 0);
});

test("saveSharedState never throws or returns a rejected promise, even on failure - the caller stays fire-and-forget", () => {
  mockFetch(async () => {
    throw new Error("boom");
  });
  const store = createSaveFailureStore();
  assert.doesNotThrow(() => saveSharedState("mailingStatus", "MAIL-1::2", "Mailed", store));
});

test("many failing saves in a loop (the bulk-action shape) each count individually", async () => {
  mockFetch(async () => jsonResponse(500, {}));
  const store = createSaveFailureStore();
  for (let i = 0; i < 120; i += 1) {
    saveSharedState("mailingStatus", `MAIL-${i}::1`, "Mailed", store);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(store.getSnapshot().failedSaveCount, 120);
});

// --- loadSharedState ---

function makeTarget() {
  return { seed: null, statusOverrides: {}, componentOverrides: {}, reviewed: new Set() };
}

test("loadSharedState records a load failure (not a save failure) on a network error", async () => {
  mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const store = createSaveFailureStore();
  await loadSharedState(makeTarget(), store);

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.loadFailed, true);
  assert.match(snapshot.loadFailureMessage, /reach the server/i);
  assert.equal(snapshot.failedSaveCount, 0, "a load failure must not be counted as a save failure");
});

test("loadSharedState records a load failure with the server's error message on a non-ok response", async () => {
  mockFetch(async () => jsonResponse(500, { error: "Could not load shared CRM state." }));
  const store = createSaveFailureStore();
  await loadSharedState(makeTarget(), store);

  assert.equal(store.getSnapshot().loadFailed, true);
  assert.equal(store.getSnapshot().loadFailureMessage, "Could not load shared CRM state.");
});

test("loadSharedState records a load success and still applies the dataset/overrides exactly as before", async () => {
  const dataset = { summary: { mailingCount: 1 }, mailings: [] };
  mockFetch(async () =>
    jsonResponse(200, {
      dataset,
      statusOverrides: { "MAIL-1::2": "Mailed" },
      componentOverrides: { "MAIL-1::2::envelope": "Printed" },
      reviewed: ["MAIL-1::SUB-1::Missing email::2026-08-15"],
    }),
  );
  const store = createSaveFailureStore();
  const target = makeTarget();
  await loadSharedState(target, store);

  assert.equal(store.getSnapshot().loadFailed, false);
  assert.equal(store.getSnapshot().loadFailureMessage, null);
  assert.deepEqual(target.seed, dataset);
  assert.deepEqual(target.statusOverrides, { "MAIL-1::2": "Mailed" });
  assert.deepEqual(target.componentOverrides, { "MAIL-1::2::envelope": "Printed" });
  assert.ok(target.reviewed.has("MAIL-1::SUB-1::Missing email::2026-08-15"));
});

test("loadSharedState leaves target.seed untouched when the response body has no dataset.summary, matching pre-existing merge semantics", async () => {
  mockFetch(async () => jsonResponse(200, {}));
  const store = createSaveFailureStore();
  const target = makeTarget();
  await loadSharedState(target, store);

  assert.equal(store.getSnapshot().loadFailed, false, "the request itself succeeded (200), even though the body was empty");
  assert.equal(target.seed, null);
});
