// Proves app/crm/views/queue/Queue.tsx - the eighth view migrated to
// React (Phase 1, step 13 of the app.js decomposition - CLAUDE.md), and
// the busiest operational screen in the app - still produces the same
// markup as the legacy renderQueue()/queueRow() it replaced (removed
// from app/crm/legacy-app.js by this same change).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, against
// ALL FOUR frozen snapshots (queue.html - default; queue-batch-filter.html
// - a specific batch date; queue-status-filter.html - a specific status;
// queue-search.html - a text query) - the reason those extra states were
// captured by the original golden-snapshot harness in the first place.
//
// The write/bulk-write paths and the shell-controls-still-drive-the-list
// property are NOT testable here - this file proves markup and that the
// real onChange/onClick handlers forward the right values to their
// callback props; see tests/queue-write-path.e2e.test.mjs for the
// single-row and bulk writes proven against a real Postgres, and this
// file's own filter-composition test below for the one shell-control
// property that IS provable without either a database or jsdom.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Queue from "../app/crm/views/queue/Queue.tsx";
import { computeQueueRows } from "../app/crm/views/queue/queue-selectors.ts";
import { mailingKey } from "../lib/domain/keys.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins - see that
// file's own module comment for why - since all four committed snapshots
// were rendered against a seed built from this exact instant, with
// "today" (the batch-date resolution's own clock input) equal to it.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");
const TODAY = "2026-08-12";

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

const NOOP = () => {};

function renderQueueHtml(seed, { batchFilter = "all", statusFilter = "Open", query = "" } = {}) {
  const data = computeQueueRows(seed, {}, new Set(), batchFilter, statusFilter, query, TODAY);
  return renderToStaticMarkup(React.createElement(Queue, { data, onStatusChange: NOOP, onBulkStatus: NOOP }));
}

test("Queue.tsx (default: batchFilter 'all', statusFilter 'Open', no query) renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderQueueHtml(seed);
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/queue.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Queue.tsx's rendered output no longer matches tests/snapshots/queue.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("Queue.tsx (batchFilter '2026-08-15') renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderQueueHtml(seed, { batchFilter: "2026-08-15" });
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/queue-batch-filter.html"), "utf8");
  assert.equal(normalizeHtml(actual), normalizeHtml(expected), "Queue.tsx's batch-filtered output no longer matches tests/snapshots/queue-batch-filter.html under the normalized comparison.");
});

test("Queue.tsx (statusFilter 'Mailed') renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderQueueHtml(seed, { statusFilter: "Mailed" });
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/queue-status-filter.html"), "utf8");
  assert.equal(normalizeHtml(actual), normalizeHtml(expected), "Queue.tsx's status-filtered output no longer matches tests/snapshots/queue-status-filter.html under the normalized comparison.");
});

test("Queue.tsx (query 'Ringo') renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderQueueHtml(seed, { query: "Ringo" });
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/queue-search.html"), "utf8");
  assert.equal(normalizeHtml(actual), normalizeHtml(expected), "Queue.tsx's searched output no longer matches tests/snapshots/queue-search.html under the normalized comparison.");
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const html = renderQueueHtml(seed);
  assert.match(html, /data-status-select="MAIL-/);
  assert.match(html, /data-bulk-status="To Prepare"/);
  assert.match(html, /Production Queue/);
});

test("all three shell controls (search, status filter, batch filter) still drive the migrated list, individually and combined", () => {
  const seed = loadSeed();
  const all = computeQueueRows(seed, {}, new Set(), "all", "All", "", TODAY).rows;
  const searched = computeQueueRows(seed, {}, new Set(), "all", "All", "Ringo", TODAY).rows;
  const statusFiltered = computeQueueRows(seed, {}, new Set(), "all", "Mailed", "", TODAY).rows;
  const batchFiltered = computeQueueRows(seed, {}, new Set(), "2026-08-15", "All", "", TODAY).rows;
  const combined = computeQueueRows(seed, {}, new Set(), "2026-08-15", "Mailed", "Ringo", TODAY).rows;

  assert.ok(searched.length < all.length, "search must narrow the result set");
  assert.ok(statusFiltered.length < all.length, "the status filter must narrow the result set");
  assert.ok(batchFiltered.length < all.length, "the batch filter must narrow the result set");
  // Combining all three constraints can only ever narrow further, never
  // produce more rows than any one constraint alone would.
  assert.ok(combined.length <= Math.min(searched.length, statusFiltered.length, batchFiltered.length));
});

// Depth-first search through a React element tree (as returned by calling
// a function component directly, no ReactDOM involved) for every element
// matching a predicate, expanding nested function components on the fly -
// same technique steps 10/12 established for Exceptions.tsx's ExceptionRow
// and Subscribers.tsx's SubscriberCard. Extended here for a case those
// didn't hit: a children array itself containing another array (a
// "static text" child followed by a {list.map(...)} child, e.g. this
// view's own <span>Update shown rows:</span> plus the five mapped bulk
// buttons) - handling Array.isArray(node) directly, not just
// Array.isArray(children), lets the walk recurse into an array found at
// any depth instead of silently stopping at one nested inside another.
function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  if (typeof node.type === "function") {
    return findAll(node.type(node.props), predicate, out);
  }
  if (node.props?.children !== undefined) findAll(node.props.children, predicate, out);
  return out;
}

test("each row's real onChange calls onStatusChange with that row's exact mailing and the selected status (component-level, not just static output)", () => {
  const seed = loadSeed();
  const data = computeQueueRows(seed, {}, new Set(), "all", "Open", "", TODAY);
  assert.ok(data.rows.length > 0, "fixture invariant: at least one open mailing should be shown by default");
  const calls = [];
  const element = Queue({ data, onStatusChange: (mailing, status) => calls.push([mailing, status]), onBulkStatus: NOOP });

  const selects = findAll(element, (node) => node.type === "select" && node.props["data-status-select"] !== undefined);
  assert.equal(selects.length, data.rows.length);

  selects[0].props.onChange({ target: { value: "Mailed" } });
  assert.equal(calls.length, 1);
  assert.equal(mailingKey(calls[0][0]), mailingKey(data.rows[0]));
  assert.equal(calls[0][1], "Mailed");
});

test("each bulk-action button's real onClick calls onBulkStatus with that button's exact status (component-level, not just static output)", () => {
  const seed = loadSeed();
  const data = computeQueueRows(seed, {}, new Set(), "all", "Open", "", TODAY);
  const calls = [];
  const element = Queue({ data, onStatusChange: NOOP, onBulkStatus: (status) => calls.push(status) });

  const bulkButtons = findAll(element, (node) => node.type === "button" && node.props["data-bulk-status"] !== undefined);
  assert.equal(bulkButtons.length, 5);
  for (const button of bulkButtons) button.props.onClick();
  assert.deepEqual(calls, ["To Prepare", "Printing", "Assembling", "Ready to Mail", "Mailed"]);
});
