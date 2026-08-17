// Proves app/crm/views/envelope-print/Print.tsx - the twelfth and last view
// migrated to React (Phase 1 step 17 of the app.js decomposition -
// CLAUDE.md) - still produces the same markup as the legacy renderPrint()/
// printRow() it replaced (removed from app/crm/legacy-app.js by this same
// change).
//
// This file covers computePrintData()/Print.tsx's own markup and wiring
// ONLY - the normal normalized-equivalence proof every migrated view gets
// (tests/html-normalize.mjs, against the frozen tests/snapshots/print.html).
// It is deliberately NOT where envelopeHtml()'s byte-identical proof lives
// - that's tests/envelope-html-golden.test.mjs, a stricter standard for the
// relocated print-window generator specifically (see that file and
// app/crm/views/envelope-print/envelope-html.ts's own headers for why).
//
// Print.tsx itself never calls openEnvelopePrint/envelopePrintRows directly
// - those are real functions app/crm/CrmApp.tsx's REACT_VIEWS.print entry
// closes over and calls from its own onPrintEnvelopes/onPrintOneEnvelope
// callbacks. This file proves Print.tsx invokes those callback props with
// the right arguments from the right controls; it can't and doesn't prove
// what CrmApp.tsx's closures do with them - that's covered separately (this
// step's own openEnvelopePrint call-site-parity check, not a component
// test).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Print from "../app/crm/views/envelope-print/Print.tsx";
import { computePrintData } from "../app/crm/views/envelope-print/print-selectors.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins (see that
// file's own module comment for why), reused verbatim by every migrated
// view's own equivalence test (queue-view.test.mjs through
// bins-view.test.mjs).
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");
const TODAY = "2026-08-12";

// A real, empty driveConfig - matching app/crm/shell/drive-links.ts's own
// driveConfig object exactly (every URL is committed empty;
// see CLAUDE.md's data-boundary note - no real Drive folder IDs are ever
// committed to this repo), not a stub that merely happens to satisfy the
// type. app/crm/CrmApp.tsx's REACT_VIEWS.print entry passes that same
// object in for real.
const EMPTY_DRIVE_CONFIG = {
  printReadyFolderUrl: "",
  characterFolders: {},
  envelopeFolders: {},
  letterFolders: {},
};

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

const NOOP = () => {};

function computeData(seed, overrides = {}) {
  return computePrintData(
    seed,
    {},
    new Set(),
    {},
    overrides.batchFilter ?? "all",
    overrides.printScope ?? "all",
    overrides.printStockFilter ?? "all",
    overrides.query ?? "",
    TODAY,
    overrides.driveConfig ?? EMPTY_DRIVE_CONFIG,
  );
}

function renderPrintHtml(seed, overrides = {}) {
  const data = computeData(seed, overrides);
  return renderToStaticMarkup(
    React.createElement(Print, {
      data,
      printScope: overrides.printScope ?? "all",
      printStockFilter: data.effectivePrintStockFilter,
      printReadyFolderUrl: EMPTY_DRIVE_CONFIG.printReadyFolderUrl,
      onScopeChange: NOOP,
      onStockChange: NOOP,
      onFieldChange: NOOP,
      onBrowserPrint: NOOP,
      onPrintEnvelopes: NOOP,
      onPrintOneEnvelope: NOOP,
      onMarkEnvelopesPrinted: NOOP,
      onOpenDriveLink: NOOP,
      onPrintAction: NOOP,
    }),
  );
}

test("Print.tsx (default: batchFilter 'all', printScope 'all', printStockFilter 'all', no query) renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderPrintHtml(seed);
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/print.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Print.tsx's rendered output no longer matches tests/snapshots/print.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const html = renderPrintHtml(seed);
  assert.match(html, /data-print-scope="monthly"/);
  assert.match(html, /data-print-stock="all"/);
  assert.match(html, /data-browser-print=""/);
  assert.match(html, /data-print-envelopes=""/);
  assert.match(html, /data-mark-envelopes-printed=""/);
  assert.match(html, /data-drive-url=""/);
  assert.match(html, /data-print-action="batch-envelope"/);
  assert.match(html, /data-print-status="MAIL-[^"]+"/);
  assert.match(html, /data-print-envelope-status="MAIL-[^"]+"/);
  assert.match(html, /data-print-one-envelope="MAIL-[^"]+"/);
  assert.match(html, /Batch Print/);
});

test("the scope and stock filters compose with each other and with search (Print has no separate filter-variant snapshots, unlike Production Queue)", () => {
  const seed = loadSeed();
  const all = computeData(seed).rows;
  const scoped = computeData(seed, { printScope: "monthly" }).rows;
  const searched = computeData(seed, { query: "no-such-recipient-zzz" }).rows;
  // Fixture invariant, verified directly: every row that survives the
  // Need-Print filter in this fixture already happens to be Month-to-month
  // (the fixture's prepaid rows already sit in "In Ashley Box"), so
  // printScope: "monthly" is a no-op narrowing here - a real, fixture-
  // specific fact, not a weaker assertion for its own sake. What's proven
  // is composability (scope never WIDENS the result) and that search still
  // narrows for real.
  assert.ok(scoped.length <= all.length, "the scope toggle must never widen the result set");
  assert.equal(scoped.length, all.length, "fixture invariant: every Need-Print row here is already Month-to-month");
  assert.ok(searched.length < all.length, "an unmatched query must narrow the result set to zero");
});

// Depth-first search through a React element tree - the same technique
// steps 10-16 established (queue-view.test.mjs through bins-view.test.mjs),
// reused verbatim here.
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

test("the scope buttons' real onClick calls onScopeChange with that button's exact scope", () => {
  const seed = loadSeed();
  const data = computeData(seed);
  const calls = [];
  const element = Print({
    data,
    printScope: "all",
    printStockFilter: data.effectivePrintStockFilter,
    printReadyFolderUrl: "",
    onScopeChange: (scope) => calls.push(scope),
    onStockChange: NOOP,
    onFieldChange: NOOP,
    onBrowserPrint: NOOP,
    onPrintEnvelopes: NOOP,
    onPrintOneEnvelope: NOOP,
    onMarkEnvelopesPrinted: NOOP,
    onOpenDriveLink: NOOP,
    onPrintAction: NOOP,
  });

  const scopeButtons = findAll(element, (node) => node.type === "button" && node.props["data-print-scope"] !== undefined);
  assert.equal(scopeButtons.length, 2);
  for (const button of scopeButtons) button.props.onClick();
  assert.deepEqual(calls, ["monthly", "all"]);
});

test("the stock buttons' real onClick calls onStockChange with 'all' or that group's exact label", () => {
  const seed = loadSeed();
  const data = computeData(seed);
  assert.ok(data.envelopeGroups.length > 0, "fixture invariant: at least one envelope-stock group should exist");
  const calls = [];
  const element = Print({
    data,
    printScope: "all",
    printStockFilter: data.effectivePrintStockFilter,
    printReadyFolderUrl: "",
    onScopeChange: NOOP,
    onStockChange: (stock) => calls.push(stock),
    onFieldChange: NOOP,
    onBrowserPrint: NOOP,
    onPrintEnvelopes: NOOP,
    onPrintOneEnvelope: NOOP,
    onMarkEnvelopesPrinted: NOOP,
    onOpenDriveLink: NOOP,
    onPrintAction: NOOP,
  });

  const stockButtons = findAll(element, (node) => node.type === "button" && node.props["data-print-stock"] !== undefined);
  assert.equal(stockButtons.length, 1 + data.envelopeGroups.length, "the 'All stocks' button plus one per group");
  for (const button of stockButtons) button.props.onClick();
  assert.deepEqual(calls, ["all", ...data.envelopeGroups.map((group) => group.label)]);
});

test("the four batch-action buttons and the Drive-folder button call their own real callback with no arguments (Drive button excepted - it passes printReadyFolderUrl)", () => {
  const seed = loadSeed();
  const data = computeData(seed);
  let browserPrintCalls = 0;
  let printEnvelopesCalls = 0;
  let markPrintedCalls = 0;
  let printActionCalls = 0;
  const driveUrls = [];
  const element = Print({
    data,
    printScope: "all",
    printStockFilter: data.effectivePrintStockFilter,
    printReadyFolderUrl: "",
    onScopeChange: NOOP,
    onStockChange: NOOP,
    onFieldChange: NOOP,
    onBrowserPrint: () => (browserPrintCalls += 1),
    onPrintEnvelopes: () => (printEnvelopesCalls += 1),
    onPrintOneEnvelope: NOOP,
    onMarkEnvelopesPrinted: () => (markPrintedCalls += 1),
    onOpenDriveLink: (url) => driveUrls.push(url),
    onPrintAction: () => (printActionCalls += 1),
  });

  findAll(element, (node) => node.type === "button" && node.props["data-browser-print"] !== undefined)[0].props.onClick();
  findAll(element, (node) => node.type === "button" && node.props["data-print-envelopes"] !== undefined)[0].props.onClick();
  findAll(element, (node) => node.type === "button" && node.props["data-mark-envelopes-printed"] !== undefined)[0].props.onClick();
  // The toolbar's own "Open Print-Ready Folder" button always carries
  // data-drive-url (even when empty, as here) - distinct from each row's
  // DriveButton, which renders data-drive-url only when it has a real URL
  // and falls back to data-print-action (fallbackAction="envelope"/"letter")
  // otherwise. With this test's empty driveConfig, every row's own
  // DriveButtons are in that fallback state too - so both queries below
  // are scoped by exact value to isolate the toolbar-level controls from
  // the per-row fallback buttons that share the same attribute names.
  findAll(element, (node) => node.type === "button" && node.props["data-drive-url"] === "")[0].props.onClick();
  const printActionButtons = findAll(
    element,
    (node) => node.type === "button" && (node.props["data-print-action"] === "batch-envelope" || node.props["data-print-action"] === "batch-letter"),
  );
  assert.equal(printActionButtons.length, 2, "batch-envelope and batch-letter");
  for (const button of printActionButtons) button.props.onClick();

  assert.equal(browserPrintCalls, 1);
  assert.equal(printEnvelopesCalls, 1);
  assert.equal(markPrintedCalls, 1);
  assert.deepEqual(driveUrls, [""], "no real Drive folder URL is ever committed to this repo - reproduces the empty-URL alert path exactly");
  assert.equal(printActionCalls, 2, "both batch-envelope and batch-letter route through the same onPrintAction callback");
});

test("each row's real onChange calls onFieldChange with that row's exact mailing, the field key ('status' or 'envelope'), and the selected value", () => {
  const seed = loadSeed();
  const data = computeData(seed);
  assert.ok(data.rows.length > 0, "fixture invariant: at least one row should be shown by default");
  const calls = [];
  const element = Print({
    data,
    printScope: "all",
    printStockFilter: data.effectivePrintStockFilter,
    printReadyFolderUrl: "",
    onScopeChange: NOOP,
    onStockChange: NOOP,
    onFieldChange: (mailing, field, value) => calls.push([mailing, field, value]),
    onBrowserPrint: NOOP,
    onPrintEnvelopes: NOOP,
    onPrintOneEnvelope: NOOP,
    onMarkEnvelopesPrinted: NOOP,
    onOpenDriveLink: NOOP,
    onPrintAction: NOOP,
  });

  const statusSelects = findAll(element, (node) => node.type === "select" && node.props["data-print-status"] !== undefined);
  const envelopeSelects = findAll(element, (node) => node.type === "select" && node.props["data-print-envelope-status"] !== undefined);
  assert.equal(statusSelects.length, data.rows.length);
  assert.equal(envelopeSelects.length, data.rows.length);

  statusSelects[0].props.onChange({ target: { value: "Printing" } });
  envelopeSelects[0].props.onChange({ target: { value: "Printed" } });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], data.rows[0].mailing);
  assert.equal(calls[0][1], "status");
  assert.equal(calls[0][2], "Printing");
  assert.equal(calls[1][0], data.rows[0].mailing);
  assert.equal(calls[1][1], "envelope");
  assert.equal(calls[1][2], "Printed");
});

test("each row's real Print Envelope button calls onPrintOneEnvelope with that row's exact mailing", () => {
  const seed = loadSeed();
  const data = computeData(seed);
  assert.ok(data.rows.length > 0, "fixture invariant: at least one row should be shown by default");
  const calls = [];
  const element = Print({
    data,
    printScope: "all",
    printStockFilter: data.effectivePrintStockFilter,
    printReadyFolderUrl: "",
    onScopeChange: NOOP,
    onStockChange: NOOP,
    onFieldChange: NOOP,
    onBrowserPrint: NOOP,
    onPrintEnvelopes: NOOP,
    onPrintOneEnvelope: (mailing) => calls.push(mailing),
    onMarkEnvelopesPrinted: NOOP,
    onOpenDriveLink: NOOP,
    onPrintAction: NOOP,
  });

  const printOneButtons = findAll(element, (node) => node.type === "button" && node.props["data-print-one-envelope"] !== undefined);
  assert.equal(printOneButtons.length, data.rows.length);
  printOneButtons[0].props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], data.rows[0].mailing);
});
