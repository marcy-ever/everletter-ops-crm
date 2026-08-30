// Proves app/crm/views/subscribers/{Subscribers,SubscriberProfile}.tsx -
// the seventh view migrated to React (Phase 1, step 12 of the app.js
// decomposition - CLAUDE.md), and the largest one so far - still produce
// the same markup as the legacy renderSubscribers()/subscriberCard()/
// subscriberProfile()/profileMailingRow()/profileMailingCard() they
// replaced (removed from app/crm/legacy-app.js by this same change).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, against
// BOTH frozen snapshots (subscribers.html - the default first-row
// selection, and subscribers-selected.html - Ava explicitly selected),
// each of which includes the mobile card list alongside the desktop
// table - the first migrated view where a single snapshot has to prove
// both renderings at once.
//
// The write/print actions and the shell-driven-search property are NOT
// testable here - this file proves markup and that the real onClick/
// onChange handlers forward the right values to their callback props;
// see tests/subscribers-write-path.e2e.test.mjs for the two write
// actions proven against a real Postgres, and this file's own
// shell-search test below for the one property that IS provable without
// either a database or jsdom.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Subscribers from "../app/crm/views/subscribers/Subscribers.tsx";
import { computeSubscriberProfile, computeSubscriberRows, selectSubscriber } from "../app/crm/views/subscribers/subscribers-selectors.ts";
import { mailingKey } from "../lib/domain/keys.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins - see that
// file's own module comment for why - since both committed snapshots
// were rendered against a seed built from this exact instant.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

const NOOP = () => {};

function renderSubscribersHtml(seed, selectedSubscriberId) {
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, selectedSubscriberId);
  const profile = selected ? computeSubscriberProfile(seed, {}, new Set(), {}, selected) : null;
  return renderToStaticMarkup(
    React.createElement(Subscribers, {
      rows,
      selected,
      onSelect: NOOP,
      profile,
      onPrintAllEnvelopes: NOOP,
      onPrintEnvelope: NOOP,
      onMarkPrinted: NOOP,
      onMarkAshley: NOOP,
      onNeedsDoneChange: NOOP,
      onCustomerStatusChange: NOOP,
    }),
  );
}

test("Subscribers.tsx (default: no prior selection, falls back to the first row) renders markup equivalent to the frozen legacy snapshot - desktop table AND mobile cards", () => {
  const seed = loadSeed();
  const actual = renderSubscribersHtml(seed, "");
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/subscribers.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Subscribers.tsx's rendered output no longer matches tests/snapshots/subscribers.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("Subscribers.tsx (Ava explicitly selected) renders markup equivalent to the frozen legacy snapshot - desktop table AND mobile cards", () => {
  const seed = loadSeed();
  const ava = seed.subscribers.find((subscriber) => subscriber.email === "ava.example@example.test");
  assert.ok(ava, "fixture invariant: Ava's subscriber should exist in the built seed");
  const actual = renderSubscribersHtml(seed, ava.subscriberId);
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/subscribers-selected.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Subscribers.tsx's Ava-selected rendered output no longer matches tests/snapshots/subscribers-selected.html under the normalized comparison.",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const html = renderSubscribersHtml(seed, "");
  assert.match(html, /subscriber-card/);
  assert.match(html, /subscriber-profile/);
  assert.match(html, /profile-mobile-cards/);
  assert.match(html, /data-profile-print-envelope="MAIL-/);
  assert.match(html, /Activity History/);
  assert.match(html, /Current mailing progress/);
  assert.match(html, /Next mailing/);
  assert.match(html, /Past, current, and future letters/);
});

test("month-to-month profiles show their renewal day beside mailing progress", () => {
  const seed = loadSeed();
  const monthly = seed.subscribers.find((subscriber) => seed.subscriptions.some((subscription) => subscription.subscriberId === subscriber.subscriberId && subscription.plan === "Month-to-month"));
  assert.ok(monthly);
  const html = renderSubscribersHtml(seed, monthly.subscriberId);
  assert.match(html, /Monthly renewal/);
  assert.match(html, /Every \d+(?:st|nd|rd|th)/);
  assert.match(html, /Latest:/);
});

test("customer activity shows a clear description, before-and-after values, and who made the change", () => {
  const seed = loadSeed();
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, "");
  const profile = computeSubscriberProfile(seed, {}, new Set(), {}, selected);
  const html = renderToStaticMarkup(React.createElement(Subscribers, {
    rows, selected, onSelect: NOOP, profile,
    onPrintAllEnvelopes: NOOP, onPrintEnvelope: NOOP, onMarkPrinted: NOOP,
    onMarkAshley: NOOP, onNeedsDoneChange: NOOP, onCustomerStatusChange: NOOP,
    activity: { loading: false, failed: false, events: [{
      id: 1, occurredAt: "2026-08-30T18:00:00.000Z", actorEmail: "marcy@example.test",
      kind: "mailingShipDate", previousValue: "2026-09-01", newValue: "2026-09-15",
    }] },
  }));
  assert.match(html, /Ship date changed/);
  assert.match(html, /2026-09-01 → 2026-09-15/);
  assert.match(html, /marcy@example\.test/);
});

test("shell-driven search still filters the migrated list: computeSubscriberRows (the same function CrmApp.tsx calls with state.query) narrows the rows exactly as includesText would", () => {
  const seed = loadSeed();
  const all = computeSubscriberRows(seed, "");
  const filtered = computeSubscriberRows(seed, "Ava");
  assert.ok(filtered.length > 0, "fixture invariant: at least one subscriber should match \"Ava\"");
  assert.ok(filtered.length < all.length, "a real query must actually narrow the result set, not just pass everything through");
  assert.ok(filtered.every((subscriber) => subscriber.displayName.includes("Ava") || subscriber.email.includes("Ava") || subscriber.subscriberId.includes("Ava")));
});

// Depth-first search through a React element tree (as returned by calling
// a function component directly, no ReactDOM involved) for every element
// matching a predicate, expanding nested function components on the fly -
// same technique tests/exceptions-view.test.mjs (step 10) established for
// Exceptions.tsx's own nested ExceptionRow.
function findAll(node, predicate, out = []) {
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  if (typeof node.type === "function") {
    return findAll(node.type(node.props), predicate, out);
  }
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) findAll(child, predicate, out);
  } else if (children) {
    findAll(children, predicate, out);
  }
  return out;
}

test("each subscriber card's real onClick calls onSelect with that subscriber's exact subscriberId (component-level, not just static output)", () => {
  const seed = loadSeed();
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, "");
  const profile = computeSubscriberProfile(seed, {}, new Set(), {}, selected);
  const calls = [];
  const element = Subscribers({ rows, selected, onSelect: (id) => calls.push(id), profile, onPrintAllEnvelopes: NOOP, onPrintEnvelope: NOOP, onMarkPrinted: NOOP, onMarkAshley: NOOP, onNeedsDoneChange: NOOP, onCustomerStatusChange: NOOP });

  const selectButtons = findAll(element, (node) => node.type === "button" && node.props["data-subscriber-select"] !== undefined);
  assert.equal(selectButtons.length, rows.length);
  for (const button of selectButtons) button.props.onClick();
  assert.deepEqual(
    calls,
    rows.map((row) => row.subscriberId),
  );
});

test("each of the three profile action buttons' real onClick calls the matching callback with the exact mailing row (component-level, not just static output)", () => {
  const seed = loadSeed();
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, "");
  const profile = computeSubscriberProfile(seed, {}, new Set(), {}, selected);
  assert.ok(profile.openRows.length > 0, "fixture invariant: the default-selected subscriber should have at least one open mailing");

  const printCalls = [];
  const printedCalls = [];
  const ashleyCalls = [];
  const element = Subscribers({
    rows,
    selected,
    onSelect: NOOP,
    profile,
    onPrintAllEnvelopes: NOOP,
    onPrintEnvelope: (mailing) => printCalls.push(mailing),
    onMarkPrinted: (mailing) => printedCalls.push(mailing),
    onMarkAshley: (mailing) => ashleyCalls.push(mailing),
    onNeedsDoneChange: NOOP,
    onCustomerStatusChange: NOOP,
  });

  const printButtons = findAll(element, (node) => node.type === "button" && node.props["data-profile-print-envelope"] !== undefined);
  const markPrintedButtons = findAll(element, (node) => node.type === "button" && node.props["data-profile-mark-envelope"] !== undefined);
  const markAshleyButtons = findAll(element, (node) => node.type === "button" && node.props["data-profile-mark-ashley"] !== undefined);
  // Each action appears twice per row - once in the desktop table, once
  // in the mobile card - both rendered unconditionally (CSS, not React,
  // decides which is visible), matching legacy exactly.
  assert.equal(printButtons.length, profile.openRows.length * 2);
  assert.equal(markPrintedButtons.length, profile.openRows.length * 2);
  assert.equal(markAshleyButtons.length, profile.openRows.length * 2);

  printButtons[0].props.onClick();
  markPrintedButtons[0].props.onClick();
  markAshleyButtons[0].props.onClick();
  assert.equal(mailingKey(printCalls[0]), mailingKey(profile.openRows[0]));
  assert.equal(mailingKey(printedCalls[0]), mailingKey(profile.openRows[0]));
  assert.equal(mailingKey(ashleyCalls[0]), mailingKey(profile.openRows[0]));
});

test("no subscriber selected (e.g. every row filtered out by search) renders the empty state, not a profile", () => {
  const html = renderToStaticMarkup(
    React.createElement(Subscribers, { rows: [], selected: null, onSelect: NOOP, profile: null, onPrintAllEnvelopes: NOOP, onPrintEnvelope: NOOP, onMarkPrinted: NOOP, onMarkAshley: NOOP, onNeedsDoneChange: NOOP, onCustomerStatusChange: NOOP }),
  );
  assert.match(html, /No subscriber selected\./);
  assert.doesNotMatch(html, /subscriber-profile/);
});

test("a selected customer can render as a standalone profile page with a back action", () => {
  const seed = loadSeed();
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, "");
  const profile = computeSubscriberProfile(seed, {}, new Set(), {}, selected);
  let backCalls = 0;
  const element = Subscribers({
    rows,
    selected,
    onSelect: NOOP,
    profile,
    onPrintAllEnvelopes: NOOP,
    onPrintEnvelope: NOOP,
    onMarkPrinted: NOOP,
    onMarkAshley: NOOP,
    onNeedsDoneChange: NOOP,
    onCustomerStatusChange: NOOP,
    standaloneProfile: true,
    onBack: () => backCalls++,
  });
  const html = renderToStaticMarkup(element);
  assert.match(html, /Customer Profile/);
  assert.match(html, /Back to Subscribers/);
  assert.doesNotMatch(html, /subscriber-grid/);
  const backButton = findAll(element, (node) => node.type === "button" && node.props.className?.includes("profile-back-button"));
  backButton[0].props.onClick();
  assert.equal(backCalls, 1);
});

test("customer profile can print every open envelope and save a typed needs-done note", () => {
  const seed = loadSeed();
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, "");
  const profile = computeSubscriberProfile(seed, {}, new Set(), {}, selected);
  const printAllCalls = [];
  const noteCalls = [];
  const element = Subscribers({
    rows,
    selected,
    onSelect: NOOP,
    profile,
    onPrintAllEnvelopes: (mailings) => printAllCalls.push(mailings),
    onPrintEnvelope: NOOP,
    onMarkPrinted: NOOP,
    onMarkAshley: NOOP,
    onNeedsDoneChange: (mailing, value) => noteCalls.push([mailing, value]),
    onCustomerStatusChange: NOOP,
    standaloneProfile: true,
    onBack: NOOP,
  });

  const printAllButton = findAll(element, (node) => node.type === "button" && node.props.className?.includes("profile-print-all"))[0];
  printAllButton.props.onClick();
  assert.deepEqual(printAllCalls[0], profile.openRows);

  const needsDoneInput = findAll(element, (node) => node.type === "input" && node.props.className === "needs-done-input")[0];
  needsDoneInput.props.onBlur({ currentTarget: { value: "  Needs stamp  " } });
  assert.equal(mailingKey(noteCalls[0][0]), mailingKey(profile.openRows[0]));
  assert.equal(noteCalls[0][1], "Needs stamp");
});

test("customer profile can correct email and letter number", () => {
  const seed = loadSeed();
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, "");
  const profile = computeSubscriberProfile(seed, {}, new Set(), {}, selected);
  const emailCalls = [];
  const letterCalls = [];
  const shipDateCalls = [];
  const statusCalls = [];
  const element = Subscribers({
    rows, selected, onSelect: NOOP, profile,
    onPrintAllEnvelopes: NOOP, onPrintEnvelope: NOOP, onMarkPrinted: NOOP, onMarkAshley: NOOP,
    onNeedsDoneChange: NOOP, onCustomerStatusChange: NOOP,
    onEmailChange: (email) => emailCalls.push(email),
    onLetterNumberChange: (mailing, value) => letterCalls.push([mailing, value]),
    onShipDateChange: (mailing, value) => shipDateCalls.push([mailing, value]),
    onMailingStatusChange: (mailing, value) => statusCalls.push([mailing, value]),
  });
  const emailInput = findAll(element, (node) => node.type === "input" && node.props.type === "email")[0];
  emailInput.props.onBlur({ currentTarget: { value: " new@example.com " } });
  assert.deepEqual(emailCalls, ["new@example.com"]);
  const letterInput = findAll(element, (node) => node.type === "input" && node.props.className === "letter-number-input")[0];
  letterInput.props.onBlur({ currentTarget: { value: "47" } });
  assert.equal(letterCalls[0][1], "47");
  const shipDateInput = findAll(element, (node) => node.type === "input" && node.props.className === "ship-date-input")[0];
  shipDateInput.props.onBlur({ currentTarget: { value: "2026-10-15" } });
  assert.equal(shipDateCalls[0][1], "2026-10-15");
  const statusSelect = findAll(element, (node) => node.type === "select" && node.props.className?.includes("profile-status-select"))[0];
  statusSelect.props.onChange({ currentTarget: { value: "Mailed" } });
  assert.equal(statusCalls[0][1], "Mailed");
});

test("customer status requires opening the status control before the separate confirmation action", () => {
  const seed = loadSeed();
  const rows = computeSubscriberRows(seed, "");
  const selected = selectSubscriber(rows, "");
  const profile = computeSubscriberProfile(seed, {}, new Set(), {}, selected);
  const statusCalls = [];
  const element = Subscribers({
    rows,
    selected,
    onSelect: NOOP,
    profile,
    onPrintAllEnvelopes: NOOP,
    onPrintEnvelope: NOOP,
    onMarkPrinted: NOOP,
    onMarkAshley: NOOP,
    onNeedsDoneChange: NOOP,
    onCustomerStatusChange: (active) => statusCalls.push(active),
    standaloneProfile: true,
    onBack: NOOP,
  });

  const control = findAll(element, (node) => node.type === "details" && node.props.className === "customer-status-control")[0];
  assert.ok(control, "the first step is an expandable status control");
  let closed = false;
  const cancel = findAll(element, (node) => node.type === "button" && node.props.children === "Cancel")[0];
  cancel.props.onClick({ currentTarget: { closest: () => ({ removeAttribute: (name) => { if (name === "open") closed = true; } }) } });
  assert.equal(closed, true);
  assert.deepEqual(statusCalls, []);
  const confirm = findAll(element, (node) => node.type === "button" && node.props.className?.includes("customer-status-confirm-button"))[0];
  assert.deepEqual(statusCalls, []);
  confirm.props.onClick();
  assert.deepEqual(statusCalls, [false]);
});
