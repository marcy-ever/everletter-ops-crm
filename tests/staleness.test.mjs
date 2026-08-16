import assert from "node:assert/strict";
import test from "node:test";
import { createStalenessStore } from "../lib/client/staleness.ts";

// lib/client/staleness.ts's whole job is answering "has the server's
// change marker moved past what this client's own view reflects?" -
// these tests lock the three properties that make that answer trustworthy:
// a fresh store isn't stale before anything is known, a genuinely newer
// server marker makes it stale, and - the part that determines whether
// anyone keeps trusting the banner - recording this client's OWN marker
// (from its own load or its own successful save) never makes its own page
// look stale, even when a poll result arrives out of order relative to it.

test("a fresh store is not stale - nothing learned yet compares as caught up, not behind", () => {
  const store = createStalenessStore();
  assert.deepEqual(store.getSnapshot(), { stale: false, myMarker: null, serverMarker: null });
});

test("recordOwnMarker establishes both myMarker and serverMarker at once - a load learns both facts simultaneously", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(10);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.myMarker, 10);
  assert.equal(snapshot.serverMarker, 10);
  assert.equal(snapshot.stale, false);
});

test("recordServerMarker strictly greater than myMarker makes the store stale - someone else changed something", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(10);
  store.recordServerMarker(11);
  assert.equal(store.getSnapshot().stale, true);
});

test("recordServerMarker equal to myMarker does not go stale", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(10);
  store.recordServerMarker(10);
  assert.equal(store.getSnapshot().stale, false);
});

test("a user's own save (recordOwnMarker) after a poll already went stale brings the page back to current", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(10);
  store.recordServerMarker(15); // someone else changed something - now stale
  assert.equal(store.getSnapshot().stale, true);

  // The user's own save (which necessarily happened after seeing/applying
  // whatever made the server marker 15, in real usage) returns marker 16 -
  // their view has caught all the way up and gone past.
  store.recordOwnMarker(16);
  assert.equal(store.getSnapshot().stale, false, "the user's own newer save must clear staleness, not just fail to add to it");
});

test("recordOwnMarker never regresses myMarker or serverMarker - keeps the highest seen, not the most recent", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(20);
  store.recordOwnMarker(15); // arrives "later" but is a lower marker - a bulk action's responses can arrive out of order
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.myMarker, 20, "a lower marker arriving after a higher one must not move myMarker backward");
  assert.equal(snapshot.serverMarker, 20);
});

test("many out-of-order recordOwnMarker calls (the bulk-action shape) settle on the highest, and the page never goes stale from its own writes", () => {
  const store = createStalenessStore();
  const markers = [5, 12, 3, 20, 8, 19, 1, 20, 17];
  for (const marker of markers) {
    store.recordOwnMarker(marker);
  }
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.myMarker, 20);
  assert.equal(snapshot.serverMarker, 20);
  assert.equal(snapshot.stale, false, "120 of a user's own saves arriving in any order must never make their own page look stale");
});

test("recordServerMarker never regresses serverMarker either - defensive against poll responses arriving out of order", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(10);
  store.recordServerMarker(30);
  store.recordServerMarker(25); // an older poll response, arriving late
  assert.equal(store.getSnapshot().serverMarker, 30, "a lower marker from a late-arriving poll response must not move serverMarker backward");
});

test("recordOwnMarker/recordServerMarker treat null as \"nothing new learned\" - an empty audit_events table isn't behind or ahead of anything", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(null);
  assert.deepEqual(store.getSnapshot(), { stale: false, myMarker: null, serverMarker: null });

  store.recordOwnMarker(5);
  store.recordServerMarker(null); // a later poll somehow reports null - must not regress or go stale
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.myMarker, 5);
  assert.equal(snapshot.serverMarker, 5);
  assert.equal(snapshot.stale, false);
});

test("subscribe notifies on a real change and not on a no-op (equal or regressed) marker", () => {
  const store = createStalenessStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.recordOwnMarker(10);
  assert.equal(calls, 1);

  store.recordOwnMarker(10); // no change
  assert.equal(calls, 1, "recording the same marker again must not notify - nothing exposed changed");

  store.recordOwnMarker(5); // regression, ignored
  assert.equal(calls, 1);

  store.recordServerMarker(15);
  assert.equal(calls, 2);

  unsubscribe();
  store.recordServerMarker(20);
  assert.equal(calls, 2, "no further notifications after unsubscribe");
});

test("two independently created stores never share state - a factory, not a singleton", () => {
  const storeA = createStalenessStore();
  const storeB = createStalenessStore();
  storeA.recordOwnMarker(10);
  storeA.recordServerMarker(20);
  assert.equal(storeA.getSnapshot().stale, true);
  assert.deepEqual(storeB.getSnapshot(), { stale: false, myMarker: null, serverMarker: null }, "a fresh store must not see another store's markers");
});
