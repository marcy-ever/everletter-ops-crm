// Proves app/crm/views/Automation.tsx - the first view migrated to a real
// React component (Phase 1, step 6 of the app.js decomposition -
// CLAUDE.md) - still produces the same markup as the legacy
// renderAutomation() it replaced (removed from app/crm/legacy-app.js by
// this same change).
//
// Byte-identity (what tests/render-snapshots.test.mjs's own harness
// proves for every legacy-rendered view) is not achievable here and this
// file doesn't try to fake it: the legacy output's whitespace came from
// app/crm/legacy-app.js's own template literals (real newlines/indentation
// baked into the string); React's server-rendered output never carries
// that - JSX whitespace-only text between elements on separate lines is
// discarded entirely by JSX's own compiler, so renderToStaticMarkup()
// produces maximally compact HTML with no gaps between tags at all. Two
// strings that render identically in a browser can therefore differ in
// literally every line of a byte diff.
//
// So: a NORMALIZED comparison instead - explicitly weaker than
// byte-identity, and worth being honest about why it's still the
// strongest gate available without pulling in an HTML/DOM parser
// dependency this repo doesn't otherwise need (no jsdom/linkedom in
// node_modules - see this task's own "don't add a dependency" framing,
// applied here by choice, not just for the date-formatting case it was
// stated for). Normalization rules, applied to BOTH sides before
// comparing:
//
//  1. Trim whitespace (including newlines) immediately after any `>` -
//     removes indentation/newlines a template literal leaves right after
//     an opening or closing tag, whether what follows is another tag or
//     the start of that element's own text content.
//  2. Trim whitespace immediately before any `<` - the mirror of rule 1,
//     for whitespace right before a tag.
//  3. Collapse any remaining whitespace RUN (spaces/newlines/tabs, one or
//     more - now only ever found inside text content, between two real
//     words) to a single space, then trim the whole string - handles text
//     that happens to wrap across source lines without altering its
//     rendered meaning (HTML itself already collapses whitespace runs in
//     text nodes identically; this just makes the comparison agree with
//     what a browser would actually show).
//
// Verified against a real edge case rules 1-2 alone don't cover, not just
// asserted: naive "only collapse whitespace *between* two tags" leaves
// leading/trailing space stranded right after an opening tag or right
// before a closing one (e.g. "<p>  a  </p>" - the outer spaces sit next
// to only ONE tag, not between two) - rule 3's global collapse-plus-trim
// is what actually closes that gap; see this file's own normalizer
// sanity-check test.
//
// What this does NOT paper over: a real structural difference (a missing
// attribute, reordered/renamed class, different tag, different text)
// survives both rules unchanged and still fails the comparison - the
// rules only ever remove whitespace, never touch markup, attributes, or
// text content.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function normalizeHtml(html) {
  return html
    .replace(/>\s+/g, ">")
    .replace(/\s+</g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

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
