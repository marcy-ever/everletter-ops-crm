import assert from "node:assert/strict";
import test from "node:test";
import { createSaveFailureStore } from "../lib/client/save-failures.ts";

// lib/client/save-failures.ts's whole job is making a save failure that
// used to be pixel-identical to a success actually visible - these tests
// lock the three properties that make that honest: failures accumulate
// as a count (never enumerated), a later success never erases a prior
// failure, and a failed initial load is tracked as its own distinct
// fact rather than folded into the save-failure count. They also lock
// lastFailureCause tracking the most recent failure's network-vs-http
// origin, since the UI's guidance sentence branches on it.

test("a fresh store has no failures and hasn't failed to load", () => {
  const store = createSaveFailureStore();
  assert.deepEqual(store.getSnapshot(), {
    failedSaveCount: 0,
    lastFailureMessage: null,
    lastFailureCause: null,
    loadFailed: false,
    loadFailureMessage: null,
  });
});

test("recordSaveFailure increments a running count and records the message and cause", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "Network error", "network");
  let snapshot = store.getSnapshot();
  assert.equal(snapshot.failedSaveCount, 1);
  assert.equal(snapshot.lastFailureMessage, "Network error");
  assert.equal(snapshot.lastFailureCause, "network");

  store.recordSaveFailure("componentStatus", "MAIL-1::2::envelope", "HTTP 400", "http");
  snapshot = store.getSnapshot();
  assert.equal(snapshot.failedSaveCount, 2, "count keeps accumulating, not enumerating individual failures");
  assert.equal(snapshot.lastFailureMessage, "HTTP 400", "the most recent failure's message replaces the previous one");
  assert.equal(snapshot.lastFailureCause, "http", "the most recent failure's cause replaces the previous one, same as its message");
});

test("a bulk action failing many times counts every failure, not just one", () => {
  const store = createSaveFailureStore();
  for (let i = 0; i < 120; i += 1) {
    store.recordSaveFailure("mailingStatus", `MAIL-${i}::1`, "Network error", "network");
  }
  assert.equal(store.getSnapshot().failedSaveCount, 120);
});

test("recordSaveSuccess does not clear a prior failure count, message, or cause - a later success doesn't undo an earlier failure", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "Network error", "network");
  store.recordSaveFailure("mailingStatus", "MAIL-2::3", "HTTP 409: catastrophic deletion refused", "http");

  store.recordSaveSuccess("mailingStatus", "MAIL-3::4");

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.failedSaveCount, 2, "twelve failed changes don't become saved because a thirteenth one worked");
  assert.equal(snapshot.lastFailureMessage, "HTTP 409: catastrophic deletion refused");
  assert.equal(snapshot.lastFailureCause, "http");
});

test("recordSaveSuccess on a store with no prior failures leaves it clean", () => {
  const store = createSaveFailureStore();
  store.recordSaveSuccess("mailingStatus", "MAIL-1::2");
  assert.equal(store.getSnapshot().failedSaveCount, 0);
  assert.equal(store.getSnapshot().lastFailureMessage, null);
  assert.equal(store.getSnapshot().lastFailureCause, null);
});

test("recordLoadFailure sets loadFailed and its own message, independently of save failures", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "save failed", "http");
  store.recordLoadFailure("Could not reach the server - check your connection.");

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.loadFailed, true);
  assert.equal(snapshot.loadFailureMessage, "Could not reach the server - check your connection.");
  assert.equal(snapshot.failedSaveCount, 1, "a load failure must not be counted as a save failure");
  assert.equal(snapshot.lastFailureMessage, "save failed", "a load failure's message must not overwrite the save-failure message");
  assert.equal(snapshot.lastFailureCause, "http", "a load failure must not overwrite the save-failure cause either");
});

test("recordLoadSuccess clears loadFailed/loadFailureMessage but never touches save-failure state", () => {
  const store = createSaveFailureStore();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "save failed", "network");
  store.recordLoadFailure("load failed");
  store.recordLoadSuccess();

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.loadFailed, false);
  assert.equal(snapshot.loadFailureMessage, null);
  assert.equal(snapshot.failedSaveCount, 1, "a successful load must not clear a prior save failure");
  assert.equal(snapshot.lastFailureMessage, "save failed");
  assert.equal(snapshot.lastFailureCause, "network");
});

test("subscribe notifies listeners whenever the exposed snapshot actually changes, and the returned unsubscribe stops further notifications", () => {
  const store = createSaveFailureStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "x", "network");
  assert.equal(calls, 1);

  // recordSaveSuccess never changes the snapshot (see the module comment
  // and the "does not clear" test above), so it doesn't notify either -
  // nothing changed for a subscriber to react to.
  store.recordSaveSuccess("mailingStatus", "MAIL-1::2");
  assert.equal(calls, 1, "recordSaveSuccess doesn't notify - it never changes the exposed snapshot");

  store.recordLoadFailure("y");
  assert.equal(calls, 2);

  store.recordLoadSuccess();
  assert.equal(calls, 3);

  unsubscribe();
  store.recordSaveFailure("mailingStatus", "MAIL-1::2", "z", "network");
  assert.equal(calls, 3, "no further notifications after unsubscribe");
});

test("two independently created stores never share state - a factory, not a singleton", () => {
  const storeA = createSaveFailureStore();
  const storeB = createSaveFailureStore();
  storeA.recordSaveFailure("mailingStatus", "MAIL-1::2", "x", "network");
  assert.equal(storeA.getSnapshot().failedSaveCount, 1);
  assert.equal(storeB.getSnapshot().failedSaveCount, 0, "a fresh store must not see another store's failures");
});
