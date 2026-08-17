/**
 * Tracks whether recent writes to /api/shared-state actually reached the
 * server, and whether the initial shared-state load did - the two things
 * the CRM's UI had no visibility into before this store existed. A save
 * that fails is currently pixel-identical to one that succeeds: local state
 * and localStorage update optimistically either way (see
 * lib/client/shared-state-client.ts's saveSharedState), so the only sign
 * anything went wrong is that the change quietly reverts on the next
 * page load, once loadSharedState replaces state.seed wholesale from the
 * server.
 *
 * Pure, no DOM - same shape as the rest of lib/client/. A factory, not a
 * module-level singleton, for the same reason lib/client/crm-state.ts's
 * createCrmState() is - see that module's own header, and
 * app/crm/shell/crm-app-state.ts's, for the full reasoning.
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
 *
 * lastFailureCause exists because "network" and "http" failures need
 * different advice, not just different messages: telling someone to wait
 * for connectivity and retry is correct for a dropped connection and
 * actively wrong for a 409 the catastrophic-deletion guard just refused -
 * retrying that one fails again, identically, for a reason that has
 * nothing to do with being online. Recorded per most-recent-failure (same
 * "last one wins" shape as lastFailureMessage, not enumerated) so the
 * UI's guidance sentence can branch on it instead of guessing from the
 * message text.
 */

export type SaveFailureCause = "network" | "http";

export interface SaveFailureSnapshot {
  failedSaveCount: number;
  lastFailureMessage: string | null;
  lastFailureCause: SaveFailureCause | null;
  loadFailed: boolean;
  loadFailureMessage: string | null;
}

export interface SaveFailureStore {
  getSnapshot(): SaveFailureSnapshot;
  recordSaveFailure(kind: string, key: string, message: string, cause: SaveFailureCause): void;
  recordSaveSuccess(kind: string, key: string): void;
  recordLoadFailure(message: string): void;
  recordLoadSuccess(): void;
  subscribe(listener: () => void): () => void;
}

export function createSaveFailureStore(): SaveFailureStore {
  let failedSaveCount = 0;
  let lastFailureMessage: string | null = null;
  let lastFailureCause: SaveFailureCause | null = null;
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
      return { failedSaveCount, lastFailureMessage, lastFailureCause, loadFailed, loadFailureMessage };
    },

    // kind/key aren't part of the exposed snapshot (see the module
    // comment on counting vs. enumerating) - accepted here so call sites
    // already have the right shape ready for when a retry queue needs
    // them, and so this function's signature mirrors recordSaveSuccess's.
    recordSaveFailure(_kind, _key, message, cause) {
      failedSaveCount += 1;
      lastFailureMessage = message;
      lastFailureCause = cause;
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
