// Proves app/crm/views/bins/Bins.tsx - the eleventh view migrated to
// React (Phase 1 step 16 of the app.js decomposition - CLAUDE.md) - still
// produces the same markup as the legacy renderBins()/binGroupCard()/
// binRow() it replaced (removed from app/crm/legacy-app.js by this same
// change). Desktop-only - no mobile card list, confirmed rather than
// assumed (see bins-selectors.ts's own header and step 1's original
// finding).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, against
// the one frozen snapshot (tests/snapshots/bins.html) - Bins never had
// separate filter-variant snapshots, so this file's own "shell controls
// compose correctly" test below is what proves that composition.
//
// The write paths (per-row selects, both bulk actions, print) are NOT
// testable here - see tests/bins-write-path.e2e.test.mjs for the real
// Postgres-backed proof, and this file's own component-level tests below
// for the real onChange/onClick wiring.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Bins from "../app/crm/views/bins/Bins.tsx";
import { computeBinsData } from "../app/crm/views/bins/bins-selectors.ts";
import { mailingKey } from "../lib/domain/keys.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins - see that
// file's own module comment for why.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");
const TODAY = "2026-08-12";

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

const NOOP = () => {};

function renderBinsHtml(seed, { batchFilter = "all", query = "" } = {}) {
  const data = computeBinsData(seed, {}, new Set(), {}, batchFilter, query, TODAY);
  return renderToStaticMarkup(React.createElement(Bins, { data, onFieldChange: NOOP, onBulkMark: NOOP, onPrint: NOOP }));
}

test("Bins.tsx (default: batchFilter 'all', no query) renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderBinsHtml(seed);
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/bins.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Bins.tsx's rendered output no longer matches tests/snapshots/bins.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const html = renderBinsHtml(seed);
  assert.match(html, /data-bin-select="MAIL-[^"]+::field::envelope"/);
  assert.match(html, /data-bin-mark="ready"/);
  assert.match(html, /data-bin-mark="check"/);
  assert.match(html, /data-bin-print/);
  assert.match(html, /Ashley Bins/);
  assert.doesNotMatch(html, /mobile-card-list|mobile-action-card/, "no mobile card list here - that markup lives in Batch Packet");
});

// Moved from tests/render-snapshots.test.mjs (step 16's own migration) -
// the task the golden-snapshot harness was built for (step 1, CLAUDE.md)
// assumed Ashley Bins renders both desktop rows and mobile cards; checking
// found the opposite (renderBins() had no mobile-card markup at all - the
// mobile card list lived in Batch Packet's renderPacket() instead, under
// the confusingly bin-themed name). Both halves of that finding's own
// verification have now moved out of the legacy-sandbox-based harness:
// Packet's is in tests/packet-view.test.mjs, this one checks Bins.tsx's
// own real output instead of #viewMount, which is deliberately empty now.
test("Ashley Bins renders its two desktop sections (summary cards and the detailed checklist table) - no mobile cards, verified rather than assumed", () => {
  const seed = loadSeed();
  const html = renderBinsHtml(seed);
  assert.match(html, /class="packet-grid bin-group-grid"/, "expected the summary bin-group cards");
  assert.match(html, /<table class="packet-table">/, "expected the desktop bin-row checklist table");
  assert.doesNotMatch(html, /mobile-card-list|mobile-action-card/, "Bins.tsx has no mobile-card markup - if this starts matching, the finding above is stale and this test (and its comment) need updating");
});

test("the batch filter composes with the search box (Bins has no separate filter-variant snapshots)", () => {
  const seed = loadSeed();
  const all = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY).rows;
  const searched = computeBinsData(seed, {}, new Set(), {}, "all", "Ringo", TODAY).rows;
  const batchFiltered = computeBinsData(seed, {}, new Set(), {}, "2026-07-15", "", TODAY).rows;
  const combined = computeBinsData(seed, {}, new Set(), {}, "2026-07-15", "Ringo", TODAY).rows;

  assert.ok(searched.length < all.length, "search must narrow the result set");
  assert.ok(batchFiltered.length < all.length, "the batch filter must narrow the result set");
  assert.ok(combined.length <= Math.min(searched.length, batchFiltered.length));
});

// Depth-first search through a React element tree - same technique steps
// 10-15 established, extended in step 13 to handle a children array
// nested inside another array. Reused verbatim here.
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

test("each row's real onChange calls onFieldChange with that row's exact mailing, the field key, and the selected value", () => {
  const seed = loadSeed();
  const data = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  assert.ok(data.rows.length > 0, "fixture invariant: at least one prepaid row should be shown by default");
  const calls = [];
  const element = Bins({ data, onFieldChange: (mailing, field, value) => calls.push([mailing, field, value]), onBulkMark: NOOP, onPrint: NOOP });

  const selects = findAll(element, (node) => node.type === "select" && node.props["data-bin-select"] !== undefined);
  assert.equal(selects.length, data.rows.length * 3, "three fields (envelope/letter/location) per row");

  selects[0].props.onChange({ target: { value: "Printed" } });
  assert.equal(calls.length, 1);
  assert.equal(mailingKey(calls[0][0]), mailingKey(data.rows[0].mailing));
  assert.equal(calls[0][1], "envelope", "the first select column is always the envelope field");
  assert.equal(calls[0][2], "Printed");
});

test("both bulk-mark buttons' real onClick call onBulkMark with that button's exact mode", () => {
  const seed = loadSeed();
  const data = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  const calls = [];
  const element = Bins({ data, onFieldChange: NOOP, onBulkMark: (mode) => calls.push(mode), onPrint: NOOP });

  const readyButton = findAll(element, (node) => node.type === "button" && node.props["data-bin-mark"] === "ready")[0];
  const checkButton = findAll(element, (node) => node.type === "button" && node.props["data-bin-mark"] === "check")[0];
  readyButton.props.onClick();
  checkButton.props.onClick();
  assert.deepEqual(calls, ["ready", "check"]);
});

test("the print button's real onClick calls onPrint", () => {
  const seed = loadSeed();
  const data = computeBinsData(seed, {}, new Set(), {}, "all", "", TODAY);
  let printCalls = 0;
  const element = Bins({ data, onFieldChange: NOOP, onBulkMark: NOOP, onPrint: () => (printCalls += 1) });

  findAll(element, (node) => node.type === "button" && node.props["data-bin-print"] !== undefined)[0].props.onClick();
  assert.equal(printCalls, 1);
});
