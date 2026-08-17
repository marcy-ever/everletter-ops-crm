/**
 * Boots the CRM into the DOM markup app/page.tsx renders: binds the shell's
 * DOM element refs, restores localStorage overrides, wires nav/search/
 * filter event listeners, subscribes the save-failure and staleness
 * banners, starts change-marker polling, and loads the real shared dataset.
 * Moved from app/crm/legacy-app.js's initCrmApp()/initializeCrm() (Phase 2,
 * the monolith's deletion - CLAUDE.md).
 *
 * bootCrmApp(appState) does the real work, taking an AppState
 * (app/crm/shell/crm-app-state.ts) as an explicit parameter rather than
 * closing over the module's singleton - the same "thread it in, don't
 * close over a module singleton" reasoning app/crm/shell/render-shell.ts's
 * own header gives, and what lets tests/staleness-banner.test.mjs's
 * polling/visibility tests call this against a fresh, isolated
 * createAppState() instance instead of the one real app singleton (which
 * initCrmApp()'s own `initialized` guard only ever lets run once per page
 * load anyway). initCrmApp() - the zero-arg function app/crm/CrmApp.tsx
 * actually calls, from a browser-only mount effect - is a thin wrapper:
 * the guard against a second call (React StrictMode's double-invoked
 * effect in development would otherwise double-bind every listener) stays
 * scoped to it specifically, not to bootCrmApp() itself, since a test
 * calling bootCrmApp() several times across several test cases (each with
 * its own fresh appState and DOM stub) is doing something legitimately
 * different from the same page calling it twice.
 *
 * Deliberate, disclosed behavior change from the removed
 * app/crm/legacy-app.js's initializeCrm(): the "window.EVERLETTER_SEED
 * missing" fallback used to write an error message into #viewMount, which
 * no longer exists (removed from app/page.tsx along with this move - see
 * app/crm/shell/render-shell.ts's own header). That branch is unreachable
 * in any real deploy - public/seed-data.js is always committed and loaded
 * synchronously via a beforeInteractive <Script> tag before this module's
 * mount effect ever runs (see app/page.tsx and CLAUDE.md's own description
 * of that file) - genuinely defensive code for a state nothing in this
 * codebase can actually produce, not a real user-facing path. Logs to the
 * console instead of inventing a new DOM surface to write into, or reusing
 * #reactViewMount (which React's own portal reconciliation owns exclusively
 * - see app/crm/CrmApp.tsx's header for why that split exists at all).
 * Flagged here plainly rather than silently downgraded.
 *
 * 45 seconds (POLL_INTERVAL_MS): frequent enough that a change becomes
 * visible well within the minutes it actually takes to walk to the mailing
 * station and act on a status (the real mistake this prevents - see
 * CLAUDE.md's staleness-signal history), infrequent enough that two people
 * leaving the CRM open all day isn't meaningfully more server load than one
 * indexed aggregate query every 45s each (lib/change-marker.ts).
 *
 * bindShellElements() (app/crm/shell/render-shell.ts) stays a module-level
 * singleton even though bootCrmApp() itself is now parameterized - there is
 * exactly one real #topbarMeta/#metrics/etc. on the page for its whole
 * lifetime, a genuinely different kind of thing from `state`. A test
 * calling bootCrmApp() more than once in the same process rebinds those
 * elements each time, the same "shared globalThis-shaped stub, safe only
 * because node:test runs a file's tests sequentially" tradeoff the sandbox
 * this replaces already accepted and documented - see
 * lib/client/crm-state.ts's header for where that reasoning originates.
 */

import { loadComponentOverrides, loadReviewedExceptions, loadStatusOverrides } from "@/lib/client/local-overrides";
import { loadSharedState, pollChangeMarker } from "@/lib/client/shared-state-client";
import { appState, type AppState } from "./crm-app-state";
import { bindShellElements, render, renderView } from "./render-shell";
import { formatSaveFailureBannerHtml, formatStalenessBannerHtml } from "./banners";
import { VIEW_REGISTRY } from "./view-registry";

const POLL_INTERVAL_MS = 45000;

export interface BootedCrmApp {
  pollNow(): void;
}

export function bootCrmApp(appState: AppState): BootedCrmApp {
  const { state, notifyViewChanged, saveFailures, staleness } = appState;

  // saveFailureBanner/stalenessBanner are declared as `const` below,
  // alongside every other DOM ref this function looks up - safe for the
  // two render functions immediately following to close over by name even
  // though they're declared later in this same function body, since
  // JavaScript closures capture the binding, not the value, and neither
  // function is ever CALLED until after that later declaration has run.
  function renderSaveFailureBanner(): void {
    saveFailureBanner.innerHTML = formatSaveFailureBannerHtml(saveFailures.getSnapshot());
  }

  function renderStalenessBanner(): void {
    const snapshot = staleness.getSnapshot();
    stalenessBanner.innerHTML = formatStalenessBannerHtml(snapshot);
    if (!snapshot.stale) return;
    // Refreshing is the entire remedy for this banner - making the button
    // work here, rather than pointing someone at their browser's own
    // refresh control, is the whole point of including it.
    stalenessBanner.querySelector("[data-refresh-page]")?.addEventListener("click", () => {
      window.location?.reload?.();
    });
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function pollNow(): void {
    pollChangeMarker(staleness);
  }

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(pollNow, POLL_INTERVAL_MS);
    // Never present in a browser (setInterval returns a plain number
    // there); present in Node, where an un-ref'd timer doesn't keep the
    // process alive by itself - without this, a test calling bootCrmApp()
    // would leave a live interval behind with nothing to ever clear it,
    // and `node --test` would hang waiting for the event loop to drain
    // instead of exiting when the actual tests finish.
    (pollTimer as unknown as { unref?: () => void })?.unref?.();
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function initializeCrm(): Promise<void> {
    const seed = (window as unknown as { EVERLETTER_SEED?: unknown }).EVERLETTER_SEED;
    if (seed) {
      state.seed = seed as typeof state.seed;
      await loadSharedState(state, saveFailures, staleness).catch(() => {});
      render(state, notifyViewChanged);
    } else {
      // See this module's own header for why this is a console-only,
      // deliberately disclosed fallback rather than a DOM write.
      console.error("Could not load Everletter seed data.");
    }
  }

  const hashView = window.location.hash.slice(1);
  state.activeView = Object.hasOwn(VIEW_REGISTRY, hashView) ? hashView : "queue";
  state.reviewed = loadReviewedExceptions();
  state.statusOverrides = loadStatusOverrides();
  state.componentOverrides = loadComponentOverrides();

  const topbarMeta = document.querySelector("#topbarMeta") as HTMLElement;
  const metrics = document.querySelector("#metrics") as HTMLElement;
  const statusStrip = document.querySelector("#statusStrip") as HTMLElement;
  const searchInput = document.querySelector("#searchInput") as HTMLInputElement;
  const statusFilter = document.querySelector("#statusFilter") as HTMLSelectElement;
  const statusFilterWrap = document.querySelector("#statusFilterWrap") as HTMLElement;
  const batchFilter = document.querySelector("#batchFilter") as HTMLSelectElement;
  const batchFilterWrap = document.querySelector("#batchFilterWrap") as HTMLElement;
  const pastBatchFilter = document.querySelector("#pastBatchFilter") as HTMLSelectElement;
  const pastBatchFilterWrap = document.querySelector("#pastBatchFilterWrap") as HTMLElement;
  const saveFailureBanner = document.querySelector("#saveFailureBanner") as HTMLElement;
  const stalenessBanner = document.querySelector("#stalenessBanner") as HTMLElement;

  bindShellElements({
    topbarMeta,
    metrics,
    statusStrip,
    statusFilter,
    statusFilterWrap,
    batchFilter,
    batchFilterWrap,
    pastBatchFilter,
    pastBatchFilterWrap,
  });

  // Independent of renderShell()/renderView() on purpose (see
  // app/crm/shell/banners.ts's own header) - a save failure has to show up
  // the moment it's recorded, not wait for the next full render(), and has
  // to stay visible no matter which view is currently active. Rendered
  // once immediately in case state already has something to show (there
  // won't be, this early - state-of-things-so-far), then on every
  // subsequent change.
  renderSaveFailureBanner();
  saveFailures.subscribe(renderSaveFailureBanner);

  // Same immediate-render-then-subscribe shape as above, for the same
  // reason. Polling itself (startPolling(), below) is what actually keeps
  // this banner honest over time - this alone only reacts to markers this
  // client already learned some other way (its own initial load or save).
  renderStalenessBanner();
  staleness.subscribe(renderStalenessBanner);

  // Pause polling when the tab is hidden (no point spending requests on a
  // banner nobody can see) and check immediately on becoming visible again
  // - that's the scenario this feature actually exists for: someone comes
  // back to a tab left open for an hour, which is exactly when acting on
  // stale data becomes a real mailing-day risk.
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopPolling();
    } else {
      pollNow();
      startPolling();
    }
  });
  startPolling();

  document.querySelectorAll(".side-nav button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.getAttribute("data-view") || "queue";
      window.location.hash = state.activeView;
      renderView(state, notifyViewChanged);
    });
  });

  searchInput.addEventListener("input", (event) => {
    state.query = (event.target as HTMLInputElement).value;
    renderView(state, notifyViewChanged);
  });

  statusFilter.addEventListener("change", (event) => {
    state.statusFilter = (event.target as HTMLSelectElement).value;
    renderView(state, notifyViewChanged);
  });

  batchFilter.addEventListener("change", (event) => {
    state.batchFilter = (event.target as HTMLSelectElement).value;
    render(state, notifyViewChanged);
  });

  pastBatchFilter.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (!value) return;
    state.batchFilter = value;
    state.statusFilter = "All";
    render(state, notifyViewChanged);
  });

  initializeCrm();

  return { pollNow };
}

let initialized = false;
export function initCrmApp(): void {
  if (initialized) return;
  initialized = true;
  bootCrmApp(appState);
}
