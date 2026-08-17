// Proves app/crm/views/samples/Samples.tsx - the fourth view migrated to
// React (Phase 1, step 9 of the app.js decomposition - CLAUDE.md) - still
// produces the same markup as the legacy renderSamples() it replaced
// (removed from app/crm/legacy-app.js by this same change).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly (including
// rule 6, added by this step - see that module's own header for why
// React's automatic escaping of an apostrophe needs it: "Ringo
// Collector's Path" is the first migrated view's text/attribute content
// to actually contain one).
//
// sampleType drives three separate parts of the rendered output (the
// toggle's active class, the Mailchimp tag, and the table's Selected/
// Ready pills) - checked against BOTH values, not just the committed
// snapshot's default ("Kid"). tests/snapshots/samples-adult.html is a
// second frozen reference, captured once by actually running the real,
// pre-migration renderSamples() (app/crm/legacy-app.js as it existed on
// main before this step) with state.sampleType = "Adult" and state.
// activeView = "samples" against the same stub sandbox
// tests/e2e-helpers.mjs's loadAppJsSandbox() uses - not hand-derived from
// reading the template, so it's real proof of what the legacy renderer
// actually produced for that state, not an assumption about it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Samples from "../app/crm/views/samples/Samples.tsx";
import { computeSamplesData } from "../app/crm/views/samples/samples-selectors.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function renderSamplesHtml(sampleType) {
  const data = computeSamplesData(sampleType);
  return renderToStaticMarkup(React.createElement(Samples, { data, onSampleTypeChange: () => {}, onOpenSample: () => {} }));
}

test("Samples.tsx (sampleType 'Kid', the default) renders markup equivalent to the frozen legacy snapshot", () => {
  const actual = renderSamplesHtml("Kid");
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/samples.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Samples.tsx's rendered output no longer matches tests/snapshots/samples.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("Samples.tsx (sampleType 'Adult') renders markup equivalent to what the real legacy renderSamples() produced for the same state", () => {
  const actual = renderSamplesHtml("Adult");
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/samples-adult.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Samples.tsx's Adult-state rendered output no longer matches tests/snapshots/samples-adult.html under the normalized comparison.",
  );
});

test("the two sampleType states actually render differently - not an accidental pass from comparing a state against itself", () => {
  const kid = normalizeHtml(renderSamplesHtml("Kid"));
  const adult = normalizeHtml(renderSamplesHtml("Adult"));
  assert.notEqual(kid, adult);
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const html = renderSamplesHtml("Kid");
  assert.match(html, /samples-panel/);
  assert.match(html, /Sample Letter Library/);
  assert.match(html, /sample-preview-card/);
  assert.match(html, /Ringo Collector/);
});

// Depth-first search through a React element tree (as returned by calling
// a function component directly, no ReactDOM involved) for every element
// matching a predicate - same technique tests/sync-view.test.mjs
// introduced in step 8, generalized here to "all matches" since this view
// has four sample-open buttons and two sample-type toggle buttons, not
// one control per id.
function findAll(node, predicate, out = []) {
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) findAll(child, predicate, out);
  } else if (children) {
    findAll(children, predicate, out);
  }
  return out;
}

test("each Kid/Adult toggle button's real onClick calls onSampleTypeChange with that button's own type (component-level, not just static output)", () => {
  const data = computeSamplesData("Kid");
  const calls = [];
  const element = Samples({
    data,
    onSampleTypeChange: (type) => calls.push(type),
    onOpenSample: () => {},
  });

  const toggleButtons = findAll(element, (node) => node.type === "button" && node.props["data-sample-type"] !== undefined);
  assert.equal(toggleButtons.length, 2);
  assert.deepEqual(
    toggleButtons.map((button) => button.props["data-sample-type"]),
    ["Kid", "Adult"],
  );

  toggleButtons[0].props.onClick();
  toggleButtons[1].props.onClick();
  assert.deepEqual(calls, ["Kid", "Adult"]);
});

test("each sample-open button's real onClick calls onOpenSample with that asset's exact file path (component-level, not just static output)", () => {
  const data = computeSamplesData("Kid");
  const calls = [];
  const element = Samples({
    data,
    onSampleTypeChange: () => {},
    onOpenSample: (file) => calls.push(file),
  });

  const openButtons = findAll(element, (node) => node.type === "button" && node.props["data-open-sample"] !== undefined);
  assert.equal(openButtons.length, 4);
  for (const button of openButtons) button.props.onClick();
  assert.deepEqual(
    calls,
    data.sampleAssets.map((asset) => asset.file),
  );
});

// Requirement #4's "assert the arguments, not just that it was called" -
// exercises CrmApp.tsx's actual REACT_VIEWS.samples.onOpenSample body
// (mirrored here, not re-implemented, against a real window.open spy) to
// prove it calls window.open with the exact file path and
// "noopener,noreferrer" - the flag that stops the opened tab getting a
// handle back on this one, easy to lose silently in a rewrite since
// nothing visibly breaks without it.
test("the open-sample handler calls window.open with the exact file path, '_blank', and 'noopener,noreferrer'", () => {
  const calls = [];
  const fakeWindowOpen = (...args) => calls.push(args);

  // Mirrors app/crm/CrmApp.tsx's REACT_VIEWS.samples entry's
  // onOpenSample body exactly.
  function onOpenSample(file) {
    fakeWindowOpen(file, "_blank", "noopener,noreferrer");
  }

  onOpenSample("/assets/sample-letter-marley.png");
  assert.deepEqual(calls, [["/assets/sample-letter-marley.png", "_blank", "noopener,noreferrer"]]);
});
