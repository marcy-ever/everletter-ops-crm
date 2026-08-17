// Proves app/crm/views/Automation.tsx - the first view migrated to a real
// React component (Phase 1, step 6 of the app.js decomposition -
// CLAUDE.md) - still produces the same markup as the legacy
// renderAutomation() it replaced (removed from app/crm/legacy-app.js by
// this same change).
//
// Byte-identity (what tests/render-snapshots.test.mjs's own harness
// proves for every legacy-rendered view) is not achievable here and this
// file doesn't try to fake it - see tests/html-normalize.mjs's own header
// for exactly why, and for the normalization rules themselves (shared
// with tests/launch-view.test.mjs as of step 7 - every future migrated
// view reuses the same rules from there rather than redefining them).
//
// Ongoing regression coverage for this view, going forward: this file's
// own two tests ARE that coverage (equivalence against the frozen legacy
// snapshot once, permanently, plus the malformed-fixture guard below) -
// there's no separate "React snapshot" file to keep in sync on top of
// this, since tests/snapshots/automation.html already IS the committed
// reference and normalizeHtml() is deterministic. A future edit to
// Automation.tsx that changes real output breaks this test with a clear
// diff, the same guarantee tests/render-snapshots.test.mjs gives every
// other view.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Automation from "../app/crm/views/Automation.tsx";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The exact same rules tests/render-snapshots.test.mjs's own AUTOMATION_RULES
// fixture is itself "verbatim from" (that file's own comment) - read from
// the real, canonical source directly rather than duplicating the literal
// business-rule text in a second place, so neither copy can drift from
// the actual committed fallback content real app.js loads before any
// spreadsheet import. public/everletterSeed.json is UTF-8 with a leading
// BOM (verified directly - a real fetch().json() in the browser strips
// it per spec, but a raw fs.readFileSync + JSON.parse here does not and
// throws without this).
function loadAutomationRules() {
  const raw = fs.readFileSync(path.join(ROOT, "public/everletterSeed.json"), "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw).automationRules;
}

test("Automation.tsx renders markup equivalent to the frozen legacy snapshot, under the normalized comparison", () => {
  const automationRules = loadAutomationRules();
  const actual = renderToStaticMarkup(React.createElement(Automation, { automationRules }));
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/automation.html"), "utf8");

  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Automation.tsx's rendered output no longer matches tests/snapshots/automation.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see this file's own header for exactly what the normalization does and doesn't remove).",
  );
});

test("normalizeHtml() only removes whitespace - a real structural difference still fails the comparison", () => {
  const automationRules = loadAutomationRules();
  const actual = normalizeHtml(renderToStaticMarkup(React.createElement(Automation, { automationRules })));

  // Sanity check on the normalizer itself: two strings that differ only
  // in whitespace/indentation must normalize identically...
  assert.equal(normalizeHtml("<p>  a  \n  b  </p>"), normalizeHtml("<p>a b</p>"));
  // ...but a genuine content difference must not be silently erased by it.
  assert.notEqual(normalizeHtml("<p>a</p>"), normalizeHtml("<p>b</p>"));
  assert.notEqual(normalizeHtml('<p class="x">a</p>'), normalizeHtml('<p class="y">a</p>'));

  // And the real component output must actually contain the rules data,
  // not just happen to pass an empty-vs-empty comparison.
  assert.match(actual, /Mailing cadence/);
  assert.match(actual, /automation-layout/);
});
