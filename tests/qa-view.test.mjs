// Proves app/crm/views/qa/Qa.tsx - the ninth view migrated to React
// (Phase 1 step 14 of the app.js decomposition - CLAUDE.md), and the
// densest write surface in the app - still produces the same markup as
// the legacy renderQa()/qaRow()/qaSelect() it replaced (removed from
// app/crm/legacy-app.js by this same change).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, against
// the one frozen snapshot (tests/snapshots/qa.html) - unlike Production
// Queue (step 13), QA never had separate filter-variant snapshots
// captured, so this file's own "shell controls compose correctly" test
// below is what proves the printScope/batchFilter/search composition,
// same as every other migrated view without its own filter-state
// snapshots.
//
// The write/batch-action paths are NOT testable here - see
// tests/qa-write-path.e2e.test.mjs for the real Postgres-backed proof of
// the seven per-field writes, the exception-dependent defaults, and both
// batch actions at scale.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Qa from "../app/crm/views/qa/Qa.tsx";
import { computeQaData } from "../app/crm/views/qa/qa-selectors.ts";
import { mailingKey } from "../lib/domain/keys.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins (see that
// file's own module comment for why) - the real driveConfig
// (app/crm/legacy-app.js) never has any real folder URLs committed to
// this repo (see CLAUDE.md's own data-boundary note), so every mailing's
// letterFolderUrl() lookup resolves to "" regardless of character/letter
// number - this stub reproduces that real, always-empty behavior exactly,
// not a shortcut around it.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");
const TODAY = "2026-08-12";
const NO_LETTER_FOLDER = () => "";

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

const NOOP = () => {};

function renderQaHtml(seed, { batchFilter = "all", printScope = "all", query = "" } = {}) {
  const data = computeQaData(seed, {}, new Set(), {}, batchFilter, printScope, query, TODAY, NO_LETTER_FOLDER);
  return renderToStaticMarkup(
    React.createElement(Qa, { data, printScope, onScopeChange: NOOP, onFieldChange: NOOP, onMarkReady: NOOP, onMarkMailed: NOOP }),
  );
}

test("Qa.tsx (default: batchFilter 'all', printScope 'all', no query) renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderQaHtml(seed);
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/qa.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Qa.tsx's rendered output no longer matches tests/snapshots/qa.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const html = renderQaHtml(seed);
  assert.match(html, /data-qa-select="MAIL-[^"]+::field::payment"/);
  assert.match(html, /data-qa-mark-ready/);
  assert.match(html, /data-qa-mark-mailed/);
  assert.match(html, /Mailing QA/);
});

test("all three controls (search, batch filter, printScope) still drive the migrated list, individually and combined", () => {
  const seed = loadSeed();
  const all = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER).rows;
  const searched = computeQaData(seed, {}, new Set(), {}, "all", "all", "Ringo", TODAY, NO_LETTER_FOLDER).rows;
  const scoped = computeQaData(seed, {}, new Set(), {}, "all", "monthly", "", TODAY, NO_LETTER_FOLDER).rows;
  const batchFiltered = computeQaData(seed, {}, new Set(), {}, "2026-08-15", "all", "", TODAY, NO_LETTER_FOLDER).rows;
  const combined = computeQaData(seed, {}, new Set(), {}, "2026-08-15", "monthly", "Ringo", TODAY, NO_LETTER_FOLDER).rows;

  assert.ok(searched.length < all.length, "search must narrow the result set");
  assert.ok(scoped.length < all.length, "the printScope toggle must narrow the result set");
  assert.ok(batchFiltered.length < all.length, "the batch filter must narrow the result set");
  assert.ok(combined.length <= Math.min(searched.length, scoped.length, batchFiltered.length));
});

// Depth-first search through a React element tree - same technique steps
// 10-13 established, extended in step 13 (Production Queue) to handle a
// children array nested inside another array. Reused verbatim here.
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

test("each row's real onChange calls onFieldChange with that row's exact mailing, the field key, and the selected value (component-level, not just static output)", () => {
  const seed = loadSeed();
  const data = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  assert.ok(data.rows.length > 0, "fixture invariant: at least one row should be shown by default");
  const calls = [];
  const element = Qa({ data, printScope: "all", onScopeChange: NOOP, onFieldChange: (mailing, field, value) => calls.push([mailing, field, value]), onMarkReady: NOOP, onMarkMailed: NOOP });

  const selects = findAll(element, (node) => node.type === "select" && node.props["data-qa-select"] !== undefined);
  assert.equal(selects.length, data.rows.length * 7, "seven fields per row");

  selects[0].props.onChange({ target: { value: "Needs Check" } });
  assert.equal(calls.length, 1);
  assert.equal(mailingKey(calls[0][0]), mailingKey(data.rows[0].mailing));
  assert.equal(calls[0][1], "payment", "the first select column is always the payment field");
  assert.equal(calls[0][2], "Needs Check");
});

test("the scope toggle's real onClick calls onScopeChange with that button's exact scope", () => {
  const seed = loadSeed();
  const data = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  const calls = [];
  const element = Qa({ data, printScope: "all", onScopeChange: (scope) => calls.push(scope), onFieldChange: NOOP, onMarkReady: NOOP, onMarkMailed: NOOP });

  const scopeButtons = findAll(element, (node) => node.type === "button" && node.props["data-qa-scope"] !== undefined);
  assert.equal(scopeButtons.length, 2);
  for (const button of scopeButtons) button.props.onClick();
  assert.deepEqual(calls, ["monthly", "all"]);
});

test("both batch-action buttons' real onClick call their own callback with no arguments", () => {
  const seed = loadSeed();
  const data = computeQaData(seed, {}, new Set(), {}, "all", "all", "", TODAY, NO_LETTER_FOLDER);
  let readyCalls = 0;
  let mailedCalls = 0;
  const element = Qa({ data, printScope: "all", onScopeChange: NOOP, onFieldChange: NOOP, onMarkReady: () => (readyCalls += 1), onMarkMailed: () => (mailedCalls += 1) });

  const readyButton = findAll(element, (node) => node.type === "button" && node.props["data-qa-mark-ready"] !== undefined)[0];
  const mailedButton = findAll(element, (node) => node.type === "button" && node.props["data-qa-mark-mailed"] !== undefined)[0];
  readyButton.props.onClick();
  mailedButton.props.onClick();
  assert.equal(readyCalls, 1);
  assert.equal(mailedCalls, 1);
});
