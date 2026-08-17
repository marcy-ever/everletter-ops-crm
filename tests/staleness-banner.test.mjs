import assert from "node:assert/strict";
import test from "node:test";
import { formatStalenessBannerHtml } from "../app/crm/shell/banners.ts";
import { createStalenessStore } from "../lib/client/staleness.ts";
import { createAppState } from "../app/crm/shell/crm-app-state.ts";
import { bootCrmApp } from "../app/crm/shell/init-crm-app.ts";
import { installShellDomStub } from "./shell-test-helpers.mjs";

// Two different things are proven here, split the way
// app/crm/shell/banners.ts's own header explains: the banner's WORDING
// (formatStalenessBannerHtml, a pure function of a StalenessSnapshot - no
// DOM, no app boot) and the actual WIRING that keeps it honest over time
// (bootCrmApp()'s visibilitychange pause/resume, which genuinely needs a
// document to listen on). Before Phase 2 (the app.js decomposition's
// monolith deletion - CLAUDE.md) both halves went through
// tests/e2e-helpers.mjs's loadAppJsSandbox() and read back
// #stalenessBanner's captured innerHTML; now only the wiring half needs
// anything like that stub at all (tests/shell-test-helpers.mjs's much
// smaller installShellDomStub()).
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("not stale: the formatter renders nothing", () => {
  const store = createStalenessStore();
  assert.equal(formatStalenessBannerHtml(store.getSnapshot()), "");
});

test("stale: the formatter says a change happened and includes a refresh control", () => {
  const store = createStalenessStore();
  store.recordOwnMarker(5);
  store.recordServerMarker(6);

  const html = formatStalenessBannerHtml(store.getSnapshot());
  assert.match(html, /Mailing data has changed since this page loaded/);
  assert.doesNotMatch(html, /someone else/i, "must not claim who made the change - the marker can't distinguish this user's own lost-response save from a real other-user change (see the review that added this)");
  assert.match(html, /Refresh to see the latest changes/);
  assert.match(html, /data-refresh-page/, "must include a refresh control, not just tell the user to find their browser's own button");
});

// --- wiring: pollNow()/visibility, via a real bootCrmApp() ---

function jsonResponse(marker) {
  return { ok: true, json: async () => ({ ok: true, marker }) };
}

test("pollNow() driving a real (mocked) fetch to /api/change-marker updates the banner", async () => {
  const domStub = installShellDomStub();
  const appState = createAppState();
  appState.staleness.recordOwnMarker(3); // this client's own established baseline
  const { pollNow } = bootCrmApp(appState);

  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/change-marker");
    return { ok: true, json: async () => ({ marker: 9 }) };
  };
  pollNow();
  await flush();

  assert.equal(appState.staleness.getSnapshot().stale, true);
  assert.match(domStub.getCapturedHtml("#stalenessBanner"), /Mailing data has changed since this page loaded/);
});

test("pollNow() reporting a marker equal to this client's own leaves the banner empty", async () => {
  const domStub = installShellDomStub();
  const appState = createAppState();
  appState.staleness.recordOwnMarker(9);
  const { pollNow } = bootCrmApp(appState);

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ marker: 9 }) });
  pollNow();
  await flush();

  assert.equal(appState.staleness.getSnapshot().stale, false);
  assert.equal(domStub.getCapturedHtml("#stalenessBanner"), "");
});

test("a failed poll is silent - no banner, no thrown error", async () => {
  const domStub = installShellDomStub();
  const appState = createAppState();
  appState.staleness.recordOwnMarker(3);
  const { pollNow } = bootCrmApp(appState);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.doesNotThrow(() => pollNow());
  await flush();

  assert.equal(domStub.getCapturedHtml("#stalenessBanner"), "", "a poll failure must not itself produce a staleness banner");
});

test("a user's own save (updateMailingStatus) never makes their own page look stale", async () => {
  const domStub = installShellDomStub();
  const appState = createAppState();
  const aLoad = 3;
  appState.staleness.recordOwnMarker(aLoad);
  bootCrmApp(appState);

  let marker = aLoad;
  globalThis.fetch = async () => {
    marker += 1;
    return jsonResponse(marker);
  };

  appState.updateMailingStatus({ mailingId: "MAIL-1", sourceRow: 1 }, "Mailed");
  await flush();

  assert.equal(appState.staleness.getSnapshot().stale, false, "the caller's own successful save must advance its own baseline, not just the server's marker");
  assert.equal(domStub.getCapturedHtml("#stalenessBanner"), "");
});

test("a bulk action (many saves) never makes the page look stale, even though each save is its own POST", async () => {
  const domStub = installShellDomStub();
  const appState = createAppState();
  appState.staleness.recordOwnMarker(0);
  bootCrmApp(appState);

  let marker = 0;
  globalThis.fetch = async () => {
    marker += 1;
    return jsonResponse(marker);
  };

  for (let i = 0; i < 20; i += 1) {
    appState.updateMailingStatus({ mailingId: "MAIL-1", sourceRow: i }, "Mailed");
  }
  await flush();

  assert.equal(appState.staleness.getSnapshot().stale, false);
  assert.equal(domStub.getCapturedHtml("#stalenessBanner"), "");
});

// --- tab-hidden pause / visibility-regain check ---
//
// setDocumentVisibility() (tests/shell-test-helpers.mjs) simulates the real
// trigger (visibilityState changing, then a real 'visibilitychange'
// listener firing) - this proves the actual wiring in
// app/crm/shell/init-crm-app.ts's bootCrmApp() reacts to that event
// correctly. What this can't prove: that the 45-second interval itself
// would have fired had time actually passed (POLL_INTERVAL_MS is real
// wall-clock time, and nothing here fast-forwards it) - only that going
// hidden stops new polls from this mechanism and becoming visible again
// triggers exactly one immediate poll, which is the behavior this feature
// actually asks to prove ("check immediately when it becomes visible
// again").

test("becoming hidden does not itself trigger a poll", async () => {
  const domStub = installShellDomStub();
  const appState = createAppState();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ marker: 1 }) };
  };
  bootCrmApp(appState);

  domStub.setDocumentVisibility("hidden");
  await flush();

  assert.equal(fetchCalls, 0, "hiding the tab must pause future polling, not fire one itself");
});

test("becoming visible again triggers exactly one immediate poll", async () => {
  const domStub = installShellDomStub();
  const appState = createAppState();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ marker: 1 }) };
  };
  bootCrmApp(appState);

  domStub.setDocumentVisibility("hidden");
  domStub.setDocumentVisibility("visible");
  await flush();

  assert.equal(fetchCalls, 1, "regaining visibility must check immediately - exactly one poll, not zero and not a flood");
});
