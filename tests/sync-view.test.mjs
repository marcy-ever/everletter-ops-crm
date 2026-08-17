// Proves app/crm/views/sync/Sync.tsx - the third view migrated to React
// (Phase 1, step 8 of the app.js decomposition - CLAUDE.md) - still
// produces the same markup as the legacy renderSync()/getSyncPreview() it
// replaced (removed from app/crm/legacy-app.js by this same change), AND
// - the new requirement this step introduces, since Sync is the first
// migrated view with form controls - that its four inputs actually work.
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, same as
// tests/automation-view.test.mjs/tests/launch-view.test.mjs, including
// rule 4 (added by this step - see that module's header for why a
// controlled <select value=...> needs it).
//
// Control-interaction coverage (task requirement: "test it at the
// component level rather than only asserting static output") has no jsdom
// available in this repo (verified: no jsdom/linkedom in node_modules,
// same constraint tests/html-normalize.mjs's own header notes), so a real
// DOM change event can't be dispatched here. Two narrower, still-real
// proofs stand in for it instead:
//
//  1. Sync.tsx is a plain function component - calling it directly
//     (Sync(props), no ReactDOM involved) returns the exact React element
//     tree it would hand to a renderer. Walking that tree to the real
//     <select>/<input> elements and invoking their real onChange props
//     with a synthetic `{ target: { value } }` event proves Sync.tsx
//     itself correctly wires each of the four controls to the matching
//     callback prop, with the value the control actually holds - the
//     literal code path a real browser change event would drive, minus
//     the browser.
//  2. app/crm/CrmApp.tsx's REACT_VIEWS.sync entry - the one place
//     (besides legacy-app.js) allowed to touch `state` for this view -
//     mutates state.syncSubscriberId/syncSubscriptionId/syncPlan/
//     syncOrderDate exactly the way the removed legacy onchange handlers
//     did, then calls computeSyncPreview() again and re-renders. That
//     mutate-then-recompute round trip is exercised directly against a
//     plain mock state object (mirroring CrmApp.tsx's handler bodies, not
//     re-implementing sync-selectors.ts) to prove each of the four inputs
//     changes what the generated-mailings table actually shows.
//
// Real interactive click-through (does the browser really re-render on
// each control, does switching views and back preserve the selections)
// still needs a human - see this step's PR description for the itemized
// manual steps, same standing limitation as every other migrated view
// (project_no_browser_access).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Sync from "../app/crm/views/sync/Sync.tsx";
import { computeSyncPreview, defaultSyncSubscriptionId } from "../app/crm/views/sync/sync-selectors.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins - see that
// file's own module comment for why - and the same case overrides
// caseState() gave the (now-removed) "sync" case: syncSubscriberId ->
// Ava's subscriberId, syncSubscriptionId -> her Marley subscription,
// syncPlan "Month-to-month", syncOrderDate "2026-07-12". This has to
// reconstruct those exactly, since tests/snapshots/sync.html was rendered
// against them.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

function findSubscriberByEmail(seed, email) {
  const subscriber = seed.subscribers.find((item) => item.email === email);
  assert.ok(subscriber, `fixture invariant: ${email} should exist in the built seed`);
  return subscriber;
}

function findSubscription(seed, subscriberId, character) {
  const subscription = seed.subscriptions.find((item) => item.subscriberId === subscriberId && item.character === character);
  assert.ok(subscription, `fixture invariant: ${character} subscription for ${subscriberId} should exist in the built seed`);
  return subscription;
}

test("Sync.tsx renders markup equivalent to the frozen legacy snapshot, under the same normalized comparison Automation.tsx/LaunchPlan.tsx use", () => {
  const seed = loadSeed();
  const ava = findSubscriberByEmail(seed, "ava.example@example.test");
  const avaMarley = findSubscription(seed, ava.subscriberId, "Marley");
  const data = computeSyncPreview(seed, ava.subscriberId, avaMarley.subscriptionId, "Month-to-month", "2026-07-12");

  const actual = renderToStaticMarkup(
    React.createElement(Sync, {
      data,
      onSubscriberChange: () => {},
      onPlanChange: () => {},
      onOrderDateChange: () => {},
      onSubscriptionChange: () => {},
    }),
  );
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/sync.html"), "utf8");

  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Sync.tsx's rendered output no longer matches tests/snapshots/sync.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const ava = findSubscriberByEmail(seed, "ava.example@example.test");
  const avaMarley = findSubscription(seed, ava.subscriberId, "Marley");
  const data = computeSyncPreview(seed, ava.subscriberId, avaMarley.subscriptionId, "Month-to-month", "2026-07-12");
  const html = renderToStaticMarkup(
    React.createElement(Sync, {
      data,
      onSubscriberChange: () => {},
      onPlanChange: () => {},
      onOrderDateChange: () => {},
      onSubscriptionChange: () => {},
    }),
  );
  assert.match(html, /sync-layout/);
  assert.match(html, /Squarespace Sync Simulator/);
  assert.match(html, /generated-mailings/);
  assert.match(html, /SIM-/);
});

// Depth-first search through a React element tree (as returned by calling
// a function component directly, no ReactDOM involved) for the first
// element whose props.id matches. children can be a single element, an
// array, or a primitive (text) - all three appear in Sync.tsx's tree.
function findById(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.props?.id === id) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  }
  return findById(children, id);
}

test("each of the four controls' real onChange prop forwards the control's value to its matching callback prop (component-level, not just static output)", () => {
  const seed = loadSeed();
  const ava = findSubscriberByEmail(seed, "ava.example@example.test");
  const avaMarley = findSubscription(seed, ava.subscriberId, "Marley");
  const data = computeSyncPreview(seed, ava.subscriberId, avaMarley.subscriptionId, "Month-to-month", "2026-07-12");

  const calls = { subscriber: null, plan: null, orderDate: null, subscription: null };
  // Sync(props) - calling the function component directly, exactly the way
  // React itself would during render, returns the real element tree
  // without needing ReactDOM/jsdom.
  const element = Sync({
    data,
    onSubscriberChange: (value) => {
      calls.subscriber = value;
    },
    onPlanChange: (value) => {
      calls.plan = value;
    },
    onOrderDateChange: (value) => {
      calls.orderDate = value;
    },
    onSubscriptionChange: (value) => {
      calls.subscription = value;
    },
  });

  const subscriberSelect = findById(element, "syncSubscriber");
  assert.ok(subscriberSelect, "syncSubscriber select not found in the rendered tree");
  subscriberSelect.props.onChange({ target: { value: "SUB-05722BF9D0F39DCBB5A989F6" } });
  assert.equal(calls.subscriber, "SUB-05722BF9D0F39DCBB5A989F6");

  const planSelect = findById(element, "syncPlan");
  assert.ok(planSelect, "syncPlan select not found in the rendered tree");
  planSelect.props.onChange({ target: { value: "6-month" } });
  assert.equal(calls.plan, "6-month");

  const orderDateInput = findById(element, "syncOrderDate");
  assert.ok(orderDateInput, "syncOrderDate input not found in the rendered tree");
  orderDateInput.props.onChange({ target: { value: "2026-08-01" } });
  assert.equal(calls.orderDate, "2026-08-01");

  const subscriptionSelect = findById(element, "syncSubscription");
  assert.ok(subscriptionSelect, "syncSubscription select not found in the rendered tree");
  subscriptionSelect.props.onChange({ target: { value: "PLAN-C32AC16621684ED902C8C3CF" } });
  assert.equal(calls.subscription, "PLAN-C32AC16621684ED902C8C3CF");
});

// Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.sync entry's handler bodies
// exactly (mutate the relevant state.syncXxx field(s), same as the
// removed legacy onchange handlers did) against a plain mock `state`
// object, then recomputes and re-renders - proving the actual round trip
// CrmApp.tsx performs: an input change updates state and the
// generated-mailings table reflects it. Not a re-implementation of
// sync-selectors.ts - every derivation still goes through the real
// computeSyncPreview()/defaultSyncSubscriptionId().
test("changing each of the four inputs updates state and re-renders the generated-mailings table with different data", () => {
  const seed = loadSeed();
  const ava = findSubscriberByEmail(seed, "ava.example@example.test");
  const ben = findSubscriberByEmail(seed, "ben.sample@example.test");
  const avaMarley = findSubscription(seed, ava.subscriberId, "Marley");
  const avaRingo = findSubscription(seed, ava.subscriberId, "Ringo");

  const mockState = {
    syncSubscriberId: ava.subscriberId,
    syncSubscriptionId: avaMarley.subscriptionId,
    syncPlan: "Month-to-month",
    syncOrderDate: "2026-07-12",
  };

  function render() {
    const data = computeSyncPreview(seed, mockState.syncSubscriberId, mockState.syncSubscriptionId, mockState.syncPlan, mockState.syncOrderDate);
    return { data, html: renderToStaticMarkup(React.createElement(Sync, { data, onSubscriberChange() {}, onPlanChange() {}, onOrderDateChange() {}, onSubscriptionChange() {} })) };
  }

  // Assertions target `data` directly (what the summary/table actually
  // render from) rather than a plain substring/regex match against the
  // full HTML - the subscriber/subscription <select>s always list every
  // option regardless of which one is selected (see the frozen snapshot),
  // so "Ava Example"/"Marley" text is present in that dropdown's markup
  // no matter which subscriber/subscription is actually active; the
  // summary heading (data.subscriber.displayName) and selected
  // subscription (data.subscription.character) are the actual signal.
  const initial = render();
  assert.equal(initial.data.subscriber.displayName, "Ava Example");
  assert.match(initial.html, /<h4>Ava Example<\/h4>/);
  assert.equal(initial.data.newCount, 2);

  // onSubscriberChange: mirrors CrmApp.tsx's handler, which also resets
  // syncSubscriptionId to the new subscriber's first subscription.
  mockState.syncSubscriberId = ben.subscriberId;
  mockState.syncSubscriptionId = defaultSyncSubscriptionId(ben.subscriberId, seed);
  const afterSubscriberChange = render();
  assert.equal(afterSubscriberChange.data.subscriber.displayName, "Ben Sample");
  assert.match(afterSubscriberChange.html, /<h4>Ben Sample<\/h4>/);

  // onSubscriptionChange: switch back to Ava, then to her Ringo subscription.
  mockState.syncSubscriberId = ava.subscriberId;
  mockState.syncSubscriptionId = avaMarley.subscriptionId;
  mockState.syncSubscriptionId = avaRingo.subscriptionId;
  const afterSubscriptionChange = render();
  assert.equal(afterSubscriptionChange.data.subscription.character, "Ringo");
  assert.match(afterSubscriptionChange.html, /<p>Ava Example Â· Ringo Â· 6-month<\/p>/);

  // onPlanChange: Month-to-month (2 letters) -> 6-month (12 letters)
  // changes newCount and the number of generated rows.
  mockState.syncSubscriptionId = avaMarley.subscriptionId;
  mockState.syncPlan = "6-month";
  const afterPlanChange = render();
  assert.equal(afterPlanChange.data.newCount, 12);
  assert.equal(afterPlanChange.data.generated.length, 12);
  assert.notEqual(afterPlanChange.data.generated.length, initial.data.generated.length);

  // onOrderDateChange: a different order date shifts every generated ship date.
  mockState.syncPlan = "Month-to-month";
  mockState.syncOrderDate = "2026-09-01";
  const afterOrderDateChange = render();
  assert.notDeepEqual(
    afterOrderDateChange.data.generated.map((row) => row.shipDate),
    initial.data.generated.map((row) => row.shipDate),
  );
});
