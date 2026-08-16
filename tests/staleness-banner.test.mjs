import assert from "node:assert/strict";
import test from "node:test";
import { loadAppJsSandbox } from "./e2e-helpers.mjs";

// Drives the real pipeline this task adds end to end, the same way
// tests/save-failure-banner.test.mjs does for PR #38's banner: a mutator
// (updateMailingStatus) or a direct poll (pollNow()) -> lib/client/
// shared-state-client.ts -> lib/client/staleness.ts -> the real
// renderStalenessBanner() -> #stalenessBanner's real innerHTML, read back
// via loadAppJsSandbox's captureRenders/getCapturedHtml (the same
// mechanism the 36 trusted render-snapshot cases already rely on) - plus
// the tab-hidden pause/resume behavior, via the sandbox's
// setDocumentVisibility() (tests/e2e-helpers.mjs, added for this feature).
//
// loadAppJsSandbox() resets globalThis.fetch unconditionally on every call
// (see its own header comment), so a custom fetch mock has to be installed
// AFTER the sandbox is created, same caveat tests/shared-state-client-failures.test.mjs
// and tests/save-failure-banner.test.mjs both already document.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mailing(sourceRow) {
  return { mailingId: "MAIL-1", sourceRow };
}

function jsonResponse(marker) {
  return { ok: true, json: async () => ({ ok: true, marker }) };
}

test("not stale: the banner renders nothing", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  assert.equal(sandbox.getCapturedHtml("#stalenessBanner"), "");
});

test("stale: the banner says a change happened and includes a refresh control", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.staleness.recordOwnMarker(5);
  sandbox.staleness.recordServerMarker(6);

  const html = sandbox.getCapturedHtml("#stalenessBanner");
  assert.match(html, /Mailing data has changed since this page loaded/);
  assert.doesNotMatch(html, /someone else/i, "must not claim who made the change - the marker can't distinguish this user's own lost-response save from a real other-user change (see the review that added this)");
  assert.match(html, /Refresh to see the latest changes/);
  assert.match(html, /data-refresh-page/, "must include a refresh control, not just tell the user to find their browser's own button");
});

test("pollNow() driving a real (mocked) fetch to /api/change-marker updates the banner", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.staleness.recordOwnMarker(3); // this client's own established baseline

  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/change-marker");
    return { ok: true, json: async () => ({ marker: 9 }) };
  };
  sandbox.pollNow();
  await flush();

  assert.equal(sandbox.staleness.getSnapshot().stale, true);
  assert.match(sandbox.getCapturedHtml("#stalenessBanner"), /Mailing data has changed since this page loaded/);
});

test("pollNow() reporting a marker equal to this client's own leaves the banner empty", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.staleness.recordOwnMarker(9);

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ marker: 9 }) });
  sandbox.pollNow();
  await flush();

  assert.equal(sandbox.staleness.getSnapshot().stale, false);
  assert.equal(sandbox.getCapturedHtml("#stalenessBanner"), "");
});

test("a failed poll is silent - no banner, no thrown error", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.staleness.recordOwnMarker(3);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.doesNotThrow(() => sandbox.pollNow());
  await flush();

  assert.equal(sandbox.getCapturedHtml("#stalenessBanner"), "", "a poll failure must not itself produce a staleness banner");
});

test("a user's own save (updateMailingStatus) never makes their own page look stale", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  const aLoad = 3;
  sandbox.staleness.recordOwnMarker(aLoad);

  let marker = aLoad;
  globalThis.fetch = async () => {
    marker += 1;
    return jsonResponse(marker);
  };

  sandbox.updateMailingStatus(mailing(1), "Mailed");
  await flush();

  assert.equal(sandbox.staleness.getSnapshot().stale, false, "the caller's own successful save must advance its own baseline, not just the server's marker");
  assert.equal(sandbox.getCapturedHtml("#stalenessBanner"), "");
});

test("a bulk action (many saves) never makes the page look stale, even though each save is its own POST", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  sandbox.staleness.recordOwnMarker(0);

  let marker = 0;
  globalThis.fetch = async () => {
    marker += 1;
    return jsonResponse(marker);
  };

  for (let i = 0; i < 20; i += 1) {
    sandbox.updateMailingStatus(mailing(i), "Mailed");
  }
  await flush();

  assert.equal(sandbox.staleness.getSnapshot().stale, false);
  assert.equal(sandbox.getCapturedHtml("#stalenessBanner"), "");
});

// --- tab-hidden pause / visibility-regain check ---
//
// setDocumentVisibility() (tests/e2e-helpers.mjs) simulates the real
// trigger (visibilityState changing, then a real 'visibilitychange'
// listener firing) - this proves the actual wiring in
// app/crm/legacy-app.js's initCrmApp() reacts to that event correctly.
// What this can't prove: that the 45-second interval itself would have
// fired had time actually passed (POLL_INTERVAL_MS is real wall-clock
// time, and nothing here fast-forwards it) - only that going hidden stops
// new polls from this mechanism and becoming visible again triggers
// exactly one immediate poll, which is the behavior this task actually
// asks to prove ("check immediately when it becomes visible again").

test("becoming hidden does not itself trigger a poll", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ marker: 1 }) };
  };

  sandbox.setDocumentVisibility("hidden");
  await flush();

  assert.equal(fetchCalls, 0, "hiding the tab must pause future polling, not fire one itself");
});

test("becoming visible again triggers exactly one immediate poll", async () => {
  const sandbox = await loadAppJsSandbox(undefined, { captureRenders: true });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ marker: 1 }) };
  };

  sandbox.setDocumentVisibility("hidden");
  sandbox.setDocumentVisibility("visible");
  await flush();

  assert.equal(fetchCalls, 1, "regaining visibility must check immediately - exactly one poll, not zero and not a flood");
});
