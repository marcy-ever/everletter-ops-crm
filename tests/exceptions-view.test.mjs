// Proves app/crm/views/exceptions/Exceptions.tsx - the fifth view
// migrated to React (Phase 1, step 10 of the app.js decomposition -
// CLAUDE.md), and the first that writes to the server - still produces
// the same markup as the legacy renderExceptions()/exceptionRow() it
// replaced (removed from app/crm/legacy-app.js by this same change).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, same as
// every other migrated view. Two frozen references, not one:
// tests/snapshots/exceptions.html (query "") and
// tests/snapshots/exceptions-empty-search.html (query
// "zzz-nonexistent-zzz", the empty-state branch) - both real cases
// tests/render-snapshots.test.mjs's CASES used to cover before this step
// (see that file's own comment on where they moved).
//
// The write path itself (does clicking Reviewed actually persist, does it
// survive a reload, does exactly one audit row get written, does a
// rejected save surface in the banner, does the actor's own change avoid
// tripping their own staleness banner) is NOT testable here - none of
// that can be proven without a real database, and this file has no jsdom
// to dispatch a real click through anyway. See
// tests/exceptions-write-path.e2e.test.mjs for that coverage, driven
// through the real POST /api/shared-state route against a real Postgres.
// This file proves the two things that ARE provable without either: the
// component's rendered markup, and that its real onClick handlers forward
// the exact right review key to the onReview prop.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Exceptions from "../app/crm/views/exceptions/Exceptions.tsx";
import { computeExceptionRows } from "../app/crm/views/exceptions/exceptions-selectors.ts";
import { exceptionReviewKey } from "../lib/domain/keys.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins - see that
// file's own module comment for why - since tests/snapshots/exceptions.html
// and exceptions-empty-search.html were rendered against a seed built from
// this exact instant.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

function renderExceptionsHtml(query) {
  const seed = loadSeed();
  const rows = computeExceptionRows(seed, new Set(), query);
  return renderToStaticMarkup(React.createElement(Exceptions, { rows, onReview: () => {} }));
}

test("Exceptions.tsx (query \"\") renders markup equivalent to the frozen legacy snapshot", () => {
  const actual = renderExceptionsHtml("");
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/exceptions.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Exceptions.tsx's rendered output no longer matches tests/snapshots/exceptions.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("Exceptions.tsx (query \"zzz-nonexistent-zzz\", the empty-state branch) renders markup equivalent to the frozen legacy snapshot", () => {
  const actual = renderExceptionsHtml("zzz-nonexistent-zzz");
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/exceptions-empty-search.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Exceptions.tsx's empty-search rendered output no longer matches tests/snapshots/exceptions-empty-search.html under the normalized comparison.",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const html = renderExceptionsHtml("");
  assert.match(html, /exception-row/);
  assert.match(html, /Needs Review/);
  assert.match(html, /data-review="MAIL-/);
});

// Depth-first search through a React element tree (as returned by calling
// a function component directly, no ReactDOM involved) for every element
// matching a predicate - same technique tests/sync-view.test.mjs (step 8)
// and tests/samples-view.test.mjs (step 9) already use, extended here for
// Exceptions.tsx's one addition: a nested function component
// (ExceptionRow). An element whose `type` is a function hasn't been
// "rendered" yet by simply constructing it (only host elements like
// "article"/"button" get real children this way) - node.type(node.props)
// resolves it exactly the way React itself would, so the walk can
// continue into what that component actually returns instead of stopping
// at an opaque, unexpanded element.
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

test("each row's real onClick calls onReview with that row's exact exceptionReviewKey (component-level, not just static output)", () => {
  const seed = loadSeed();
  const rows = computeExceptionRows(seed, new Set(), "");
  assert.ok(rows.length > 0, "fixture invariant: at least one open exception should exist for this test to mean anything");

  const calls = [];
  const element = Exceptions({ rows, onReview: (key) => calls.push(key) });

  const reviewButtons = findAll(element, (node) => node.type === "button" && node.props["data-review"] !== undefined);
  assert.equal(reviewButtons.length, rows.length);

  for (const button of reviewButtons) button.props.onClick();
  assert.deepEqual(
    calls,
    rows.map((row) => exceptionReviewKey(row)),
  );
});

test("the key format is exactly mailingId::subscriberId::reason::shipDate - a change here would orphan real reviewed flags", () => {
  const seed = loadSeed();
  const rows = computeExceptionRows(seed, new Set(), "");
  const row = rows[0];
  const key = exceptionReviewKey(row);
  assert.equal(key, [row.mailingId, row.subscriberId, row.reason, row.shipDate || "no-ship-date"].join("::"));
  assert.equal(key.split("::").length, 4);
});
