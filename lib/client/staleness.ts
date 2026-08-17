/**
 * Tracks whether this page might be showing stale data - the "someone else
 * changed something, refresh" signal CLAUDE.md §8 has listed as its top
 * item since before this migration started. Not live sync: this store
 * answers exactly one question ("has the server's change marker moved past
 * what this client's own view reflects?") and nothing else - no diff, no
 * merge, no auto-refresh. See lib/change-marker.ts for what the marker
 * actually is (a MAX(id) over audit_events) and why it can't advance on a
 * no-op write.
 *
 * Pure, no DOM - same shape as the rest of lib/client/, and a factory for
 * the same reason lib/client/save-failures.ts's createSaveFailureStore()
 * is - see that module's own header, and app/crm/shell/crm-app-state.ts's,
 * for the full reasoning.
 *
 * Two markers, deliberately not one:
 *  - `myMarker` - the marker this client's own view is caught up to,
 *    advanced by recordOwnMarker() on a successful GET /api/shared-state
 *    load OR a successful POST save. A save advancing this immediately
 *    (not waiting for the next poll) is the entire point - see recordOwnMarker's
 *    own comment for why this is the difference between a banner people
 *    trust and one they learn to ignore.
 *  - `serverMarker` - the highest marker this client has observed from the
 *    server at all (load, poll, or a save's own response - see
 *    recordOwnMarker), advanced by recordServerMarker() on a poll result.
 *
 * `stale` is derived, not stored: serverMarker strictly greater than
 * myMarker. Both start at null ("nothing learned yet"), which compares as
 * not-stale - there's no signal to act on before the first load completes,
 * and showing a stale banner before the page has even loaded once would be
 * a false positive, not caution.
 *
 * Both recordOwnMarker and recordServerMarker keep the HIGHEST marker seen,
 * never just the most recent - required for recordOwnMarker specifically
 * because a bulk action fires many POSTs whose responses can arrive out of
 * order (see lib/client/crm-state.ts's mutators, called in a loop by
 * app/crm/CrmApp.tsx's own REACT_VIEWS bulk-action handlers); applied the
 * same way to recordServerMarker defensively, since poll responses could
 * in principle arrive out of order too and audit_events' marker only ever
 * increases.
 */

export interface StalenessSnapshot {
  stale: boolean;
  myMarker: number | null;
  serverMarker: number | null;
}

export interface StalenessStore {
  getSnapshot(): StalenessSnapshot;
  recordOwnMarker(marker: number | null): void;
  recordServerMarker(marker: number | null): void;
  subscribe(listener: () => void): () => void;
}

// null means "nothing learned yet," which must compare as caught-up (0),
// not as behind - a marker of null from the server also genuinely means
// "audit_events is empty, nothing has ever changed," so treating it the
// same way as "this client hasn't learned anything yet" is correct in
// both directions, not just a convenient default.
function normalize(marker: number | null): number {
  return marker ?? 0;
}

export function createStalenessStore(): StalenessStore {
  let myMarker: number | null = null;
  let serverMarker: number | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot() {
      return { stale: normalize(serverMarker) > normalize(myMarker), myMarker, serverMarker };
    },

    // Called on a successful GET /api/shared-state load (this client's
    // view now reflects up to the marker that response returned) and on a
    // successful POST save (lib/client/shared-state-client.ts's
    // saveSharedState reads the marker the write itself just produced).
    // The save case is what makes the feature usable at all: without it,
    // every save this user makes would advance the SERVER's marker while
    // their own view's marker stays behind, so the very next poll would
    // tell them their own page is stale because of their own change -
    // technically true and completely useless, the kind of false positive
    // that trains someone to stop reading the banner within a day.
    // Also raises serverMarker to at least this value: learning "my view
    // reflects marker M" is itself fresh, accurate information about the
    // server (the response was read after its own write/read completed),
    // so there's no reason to wait for the next poll to record it there
    // too.
    recordOwnMarker(marker) {
      let changed = false;
      if (normalize(marker) > normalize(myMarker)) {
        myMarker = marker;
        changed = true;
      }
      if (normalize(marker) > normalize(serverMarker)) {
        serverMarker = marker;
        changed = true;
      }
      if (changed) notify();
    },

    // Called on every poll result (GET /api/change-marker), successful or
    // not - a failed poll simply isn't called at all (see the poll loop in
    // app/crm/shell/init-crm-app.ts), so this only ever receives a real
    // observed value.
    recordServerMarker(marker) {
      if (normalize(marker) > normalize(serverMarker)) {
        serverMarker = marker;
        notify();
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
