/**
 * Tracks whether recent writes to /api/shared-state actually reached the
 * server, and whether the initial shared-state load did - the two things
 * app/crm/legacy-app.js's UI has no visibility into today. A save that
 * fails is currently pixel-identical to one that succeeds: local state
 * and localStorage update optimistically either way (see
 * lib/client/shared-state-client.ts's saveSharedState), so the only sign
 * anything went wrong is that the change quietly reverts on the next
 * page load, once loadSharedState replaces state.seed wholesale from the
 * server.
 *
 * Pure, no DOM - same shape as the rest of lib/client/. A factory, not a
 * module-level singleton, for the same reason lib/client/crm-state.ts's
 * createCrmState() is: tests/e2e-helpers.mjs's loadAppJsSandbox() gives
 * each snapshot case a fresh legacy-app.js module instance via a
 * cache-buster, which only works if everything module-scoped state
 * depends on is created fresh inside that module too, not shared across
 * "fresh" imports via an importable singleton here.
 *
 * Counts, doesn't enumerate: a bulk action can fail (or succeed) many
 * times in one click, and the UI this feeds says "12 changes couldn't be
 * saved," not twelve of anything - so this store keeps a running total
 * and the most recent failure's message, not a growing list of every
 * failure's kind/key. recordSaveSuccess() deliberately does not reduce
 * failedSaveCount or clear lastFailureMessage - twelve failed changes
 * don't become saved because a thirteenth one worked, and the indicator
 * built from this snapshot should keep saying so until the page reloads
 * (or a caller adds an explicit dismiss, which should not itself imply
 * the failures were saved).
 *
 * recordSaveSuccess(kind, key) exists even though today's snapshot
 * ignores its arguments entirely - this is deliberately the seam a
 * future retry queue would build on (matching a set of failed
 * kind/key/message entries against later successes to know what's still
 * actually pending), not built now because doing so without a concrete
 * retry mechanism to drive would be speculative.
 *
 * loadFailed is tracked separately from failedSaveCount on purpose: a
 * failed initial load isn't an unsaved *change* (nothing was saved
 * optimistically to lose) - it's the app not having the real data at
 * all, which needs different wording and shouldn't inflate a "changes
 * couldn't be saved" count.
 */

export interface SaveFailureSnapshot {
  failedSaveCount: number;
  lastFailureMessage: string | null;
  loadFailed: boolean;
  loadFailureMessage: string | null;
}

export interface SaveFailureStore {
  getSnapshot(): SaveFailureSnapshot;
  recordSaveFailure(kind: string, key: string, message: string): void;
  recordSaveSuccess(kind: string, key: string): void;
  recordLoadFailure(message: string): void;
  recordLoadSuccess(): void;
  subscribe(listener: () => void): () => void;
}

export function createSaveFailureStore(): SaveFailureStore {
  let failedSaveCount = 0;
  let lastFailureMessage: string | null = null;
  let loadFailed = false;
  // Kept separate from lastFailureMessage (save-specific) rather than
  // reused for both - a load failure and a later save failure are
  // distinct facts, and sharing one field would let either overwrite the
  // other's message even though both should stay visible at once.
  let loadFailureMessage: string | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot() {
      return { failedSaveCount, lastFailureMessage, loadFailed, loadFailureMessage };
    },

    // kind/key aren't part of the exposed snapshot (see the module
    // comment on counting vs. enumerating) - accepted here so call sites
    // already have the right shape ready for when a retry queue needs
    // them, and so this function's signature mirrors recordSaveSuccess's.
    recordSaveFailure(_kind, _key, message) {
      failedSaveCount += 1;
      lastFailureMessage = message;
      notify();
    },

    recordSaveSuccess() {
      // No notify() call, unlike every other record* function - this
      // never changes anything getSnapshot() exposes, so there's nothing
      // for a subscriber to react to. Takes no parameters despite the
      // SaveFailureStore interface declaring kind/key (a function may
      // ignore trailing parameters its type allows) - deliberately does
      // not touch failedSaveCount/lastFailureMessage, see the module
      // comment. A real, separate call (not a no-op caller-side skip) so
      // a future retry queue has an actual "this one succeeded, stop
      // retrying it" signal to build on, once it needs kind/key to know
      // which item.
    },

    recordLoadFailure(message) {
      loadFailed = true;
      loadFailureMessage = message;
      notify();
    },

    recordLoadSuccess() {
      loadFailed = false;
      loadFailureMessage = null;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
