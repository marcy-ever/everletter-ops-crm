// Verifies the write path app/crm/CrmApp.tsx's REACT_VIEWS.exceptions
// entry drives - Phase 1 step 10 (CLAUDE.md), the first migrated view
// that writes to the server. Everything the server side of a
// reviewedException write does (validation, audit log, key matching) is
// already covered end to end by tests/audit-events.e2e.test.mjs and
// tests/shared-state-validation.e2e.test.mjs - not re-proven here. What's
// new, and what this file actually exists to prove, is the CLIENT side:
// does the exact sequence CrmApp.tsx's onReview callback runs
// (state.reviewed.add(key), saveReviewedExceptions(), saveSharedState(),
// render()) really produce the right POST body, really remove the
// exception from the active list, really survive a reload, really write
// exactly one audit row, really refresh the shell's "Needs review" metric
// (the reason that handler calls render() and not just
// notifyViewChanged() - see CrmApp.tsx's own comment), really surface a
// rejected save in the failure banner, and really avoid tripping this
// same user's own staleness banner.
//
// globalThis.fetch is rewired (wireFetchToRealRoute, below) to call
// app/api/shared-state/route.ts's real POST/GET handlers directly,
// in-process, against a real Postgres - the same technique
// tests/audit-events.e2e.test.mjs uses for its own direct POST()/GET()
// calls, just also wired through the bare `fetch` global that
// lib/client/shared-state-client.ts (and therefore this view's onReview
// handler) actually calls. No real HTTP server/port involved.
//
// Requires a real local Postgres reachable via DATABASE_URL - skipped,
// not failed, if it isn't available. Run through `pnpm test:e2e`.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { e2eSkipReason, truncateAllTables } from "./e2e-helpers.mjs";
import { exceptionReviewKey } from "../lib/domain/keys.ts";
import { activeExceptions } from "../lib/client/selectors.ts";
import { loadSharedState, saveSharedState } from "../lib/client/shared-state-client.ts";
import { saveReviewedExceptions } from "../lib/client/local-overrides.ts";
import { createAppState } from "../app/crm/shell/crm-app-state.ts";
import { render } from "../app/crm/shell/render-shell.ts";
import { bootCrmApp } from "../app/crm/shell/init-crm-app.ts";
import { formatSaveFailureBannerHtml } from "../app/crm/shell/banners.ts";
import { installLocalStorageStub, installShellDomStub } from "./shell-test-helpers.mjs";

const skip = e2eSkipReason({ requiresFixture: false });

// Same shape tests/audit-events.e2e.test.mjs's own buildMailing/buildSeed
// use - duplicated rather than shared, per this suite's established
// convention (see tests/db-test-helpers.mjs's own comment on why
// per-file business helpers stay duplicated while only the env/sandbox
// preamble is centralized).
function buildMailing(n, overrides = {}) {
  const id = `T${n}`;
  return {
    subscriberId: `SUB-${id}`,
    subscriptionId: `PLAN-${id}`,
    recipientId: `REC-${id}`,
    orderId: `ORD-${id}`,
    mailingId: `MAIL-${id}`,
    character: "Marley",
    recipientName: `Test Recipient ${id}`,
    letterNumber: 1,
    shipDate: "2026-08-15",
    status: "To Prepare",
    activeState: "Active",
    notes: "",
    sourceRow: n,
    ...overrides,
  };
}

function buildSeed(mailingSpecs, { exceptions = [] } = {}) {
  return {
    subscribers: mailingSpecs.map((m) => ({ subscriberId: m.subscriberId, email: `${m.subscriberId}@example.test`, displayName: m.recipientName, status: "Active" })),
    recipients: mailingSpecs.map((m) => ({ recipientId: m.recipientId, subscriberId: m.subscriberId, name: m.recipientName, address: "1 Test St" })),
    subscriptions: mailingSpecs.map((m) => ({
      subscriptionId: m.subscriptionId,
      subscriberId: m.subscriberId,
      recipientId: m.recipientId,
      plan: "Month-to-month",
      character: m.character,
      startDate: "2026-01-01",
      endDate: "",
      activeState: "Active",
    })),
    orders: mailingSpecs.map((m) => ({ orderId: m.orderId, subscriberId: m.subscriberId, sourceOrderNumber: m.orderId, createdOn: "2026-01-01" })),
    mailings: mailingSpecs.map((m) => ({
      mailingId: m.mailingId,
      subscriptionId: m.subscriptionId,
      recipientId: m.recipientId,
      orderId: m.orderId,
      character: m.character,
      recipientName: m.recipientName,
      letterNumber: m.letterNumber,
      shipDate: m.shipDate,
      status: m.status,
      activeState: m.activeState,
      notes: m.notes,
      sourceRow: m.sourceRow,
    })),
    exceptions,
    automationRules: [],
    summary: {},
  };
}

function buildCrmDatasetBody(seed, { sourceName = "test-fixture.xlsx" } = {}) {
  const value = JSON.stringify({ seed, sourceName, uploadedAt: new Date().toISOString(), summary: {} });
  return JSON.stringify({ kind: "crmDataset", key: "current", value });
}

function postRequest(body) {
  return new Request("http://localhost/api/shared-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function loadRoute() {
  return import("../app/api/shared-state/route");
}

async function freshDb() {
  const { getDb } = await import("../db");
  const db = getDb();
  await truncateAllTables(db);
  const { auditEvents } = await import("../db/schema/audit_events");
  await db.delete(auditEvents);
  return db;
}

async function importSeed(POST, seed, sourceName) {
  const response = await POST(postRequest(buildCrmDatasetBody(seed, { sourceName })));
  assert.equal(response.status, 200, `seeding failed: ${JSON.stringify(await response.json().catch(() => null))}`);
}

// Rewires the bare `fetch` global - what saveSharedState/loadSharedState
// (lib/client/shared-state-client.ts) actually call - to the real route
// handlers, in-process, against whatever Postgres freshDb() just set up.
// Captures every request body it sees (capturedBodies, below) so a test
// can assert on the exact POST payload, not just its server-side effect.
//
// Also returns waitForFetches(), which every test below awaits before
// asserting: saveSharedState() is fire-and-forget from its caller's own
// perspective (it returns void, not a promise), and the wired fetch here
// does a REAL Postgres round trip - unlike
// tests/save-failure-banner.test.mjs's own flush()-only pattern, which
// only ever waits out a short, stub-fetch microtask chain, a bare
// setTimeout(resolve, 0) macrotask can fire before real database I/O
// completes (found by hitting it directly - the audit-row assertion
// below read 0 rows intermittently until this fix). waitForFetches()
// awaits the exact promise this fetch stub itself returns, so the slow
// part is never raced; a short flush() afterward still covers
// saveSharedState's own remaining microtask work (awaiting
// response.json(), updating the failure/staleness stores) once the
// fetch itself has genuinely resolved.
function wireFetchToRealRoute(POST, GET, capturedBodies) {
  const pending = [];
  globalThis.fetch = (url, options = {}) => {
    const request = new Request(`http://localhost${url}`, options);
    const promise = (async () => {
      if (options.method === "POST") {
        capturedBodies.push(await request.clone().text());
        return POST(request);
      }
      return GET(request);
    })();
    pending.push(promise);
    return promise;
  };
  return {
    async waitForFetches() {
      await Promise.all(pending);
      pending.length = 0;
    },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("clicking Reviewed sends the correct POST body, removes the exception from the active list, refreshes the shell's Needs Review count, and writes exactly one audit row", { skip }, async () => {
  const db = await freshDb();
  const { POST, GET } = await loadRoute();
  const { auditEvents } = await import("../db/schema/audit_events");

  const spec = buildMailing(1);
  const exception = { exceptionId: "EXC-1", reason: "Missing email", mailingId: spec.mailingId, subscriberId: spec.subscriberId, shipDate: spec.shipDate, sourceRow: spec.sourceRow };
  await importSeed(POST, buildSeed([spec], { exceptions: [exception] }), "seed.xlsx");

  const domStub = installShellDomStub();
  const sandbox = createAppState();
  bootCrmApp(sandbox);
  const capturedBodies = [];
  const { waitForFetches } = wireFetchToRealRoute(POST, GET, capturedBodies);
  await loadSharedState(sandbox.state, sandbox.saveFailures, sandbox.staleness);

  const key = exceptionReviewKey({ mailingId: spec.mailingId, subscriberId: spec.subscriberId, reason: exception.reason, shipDate: spec.shipDate });
  assert.ok(
    sandbox.state.seed.exceptions.some((item) => exceptionReviewKey(item) === key),
    "fixture invariant: the imported exception should be present after loadSharedState",
  );
  assert.equal(activeExceptions(sandbox.state.seed, sandbox.state.reviewed).length, 1, "fixture invariant: the exception starts unreviewed");
  // A real page load calls render() right after loadSharedState() resolves
  // (see app/crm/shell/init-crm-app.ts's bootCrmApp()) - loadSharedState()
  // alone never touches #metrics, so this establishes the real "before"
  // baseline the same way a real page load would, rather than comparing
  // against an never-yet-rendered empty string.
  render(sandbox.state, sandbox.notifyViewChanged);
  const metricsBefore = domStub.getCapturedHtml("#metrics");
  assert.match(metricsBefore, /Needs review<\/span>\s*<strong>1<\/strong>/);

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.exceptions onReview handler
  // body exactly - not a re-implementation.
  sandbox.state.reviewed.add(key);
  saveReviewedExceptions(sandbox.state.reviewed);
  saveSharedState("reviewedException", key, "1", sandbox.saveFailures, sandbox.staleness);
  await waitForFetches();
  await flush();
  render(sandbox.state, sandbox.notifyViewChanged);

  // 1. the correct POST body
  assert.equal(capturedBodies.length, 1);
  assert.deepEqual(JSON.parse(capturedBodies[0]), { kind: "reviewedException", key, value: "1" });

  // 2. the exception disappears from the active list
  assert.equal(activeExceptions(sandbox.state.seed, sandbox.state.reviewed).length, 0);

  // 3. the shell's "Needs review" metric refreshed too - the reason the
  // handler calls render(), not just notifyViewChanged() (see CrmApp.tsx).
  const metricsAfter = domStub.getCapturedHtml("#metrics");
  assert.match(metricsAfter, /Needs review<\/span>\s*<strong>0<\/strong>/);

  // 4. exactly one audit row
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "reviewedException"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemKey, key);
  assert.equal(rows[0].previousValue, "false");
  assert.equal(rows[0].newValue, "true");

  // 5. survives a reload: a fresh sandbox, loaded fresh from the server,
  // must exclude this exception too - not just this sandbox's own
  // in-memory state.
  const freshSandbox = createAppState();
  wireFetchToRealRoute(POST, GET, []);
  await loadSharedState(freshSandbox.state, freshSandbox.saveFailures, freshSandbox.staleness);
  assert.ok(freshSandbox.state.reviewed.has(key), "the review must persist server-side, not just in this tab's own state/localStorage");
  assert.equal(activeExceptions(freshSandbox.state.seed, freshSandbox.state.reviewed).length, 0);

  // 6. the actor's own change must not flag their own page stale - the
  // property that decides whether the staleness banner stays trusted.
  const snapshot = sandbox.staleness.getSnapshot();
  assert.equal(snapshot.stale, false, "reviewing an exception must not make this same client's own page look stale");
  assert.ok(snapshot.myMarker !== null && snapshot.myMarker === snapshot.serverMarker, "a successful save must advance both markers together");
});

test("a rejected save (malformed review key) surfaces in the save-failure banner instead of silently vanishing", { skip }, async () => {
  await freshDb();
  const { POST, GET } = await loadRoute();

  installLocalStorageStub();
  const sandbox = createAppState();
  const { waitForFetches } = wireFetchToRealRoute(POST, GET, []);

  // A 2-segment key - lib/validate-shared-state.ts rejects anything that
  // doesn't parse into exceptionReviewKey's real 4 segments (see
  // tests/shared-state-validation.e2e.test.mjs's own equivalent case) -
  // this is the client-side consequence of that same rejection.
  const malformedKey = "MAIL-X::SUB-X";
  saveSharedState("reviewedException", malformedKey, "1", sandbox.saveFailures, sandbox.staleness);
  await waitForFetches();
  await flush();

  const snapshot = sandbox.saveFailures.getSnapshot();
  assert.equal(snapshot.failedSaveCount, 1);
  assert.match(formatSaveFailureBannerHtml(snapshot), /1 change couldn.{1,8}t be saved/);
});
