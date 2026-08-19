// Proves app/crm/views/import/Import.tsx - the sixth view migrated to
// React (Phase 1, step 11 of the app.js decomposition - CLAUDE.md), and
// the first with a file input and an async, multi-stage flow - still
// produces the same markup as the legacy renderImport() it replaced
// (removed from app/crm/legacy-app.js by this same change).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, against
// the one committed snapshot (tests/snapshots/import.html - the
// no-preview, no-status default state; render-snapshots.test.mjs never
// exercised any other importPreview/importStatus/importBusy combination,
// so there's no second frozen reference to prove equivalence against the
// way step 9's Samples needed for its two sampleType values). The
// preview-rendered branch (never covered by any committed snapshot) gets
// its own targeted content assertions instead of a second full-page
// snapshot - proportionate coverage for markup nothing else in this
// suite has ever exercised, without inventing a "legacy ground truth"
// that was never actually captured.
//
// The full import flow itself (does selecting a real file really publish
// through the real route, does a rejected publish's 409 message really
// reach the user, does importBusy really disable the button across the
// async boundary) is NOT testable here - no jsdom to dispatch a real
// file-input change event, and no database. See
// tests/import-write-path.e2e.test.mjs for that coverage. This file
// proves the two things that ARE provable without either: the
// component's rendered markup in both its major states, and that its
// real onChange/onClick handlers forward the right values to their
// callback props.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Import from "../app/crm/views/import/Import.tsx";
import { computeImportData } from "../app/crm/views/import/import-selectors.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins - see that
// file's own module comment for why - since tests/snapshots/import.html
// was rendered against a seed built from this exact instant.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

function renderImportHtml(data) {
  return renderToStaticMarkup(React.createElement(Import, { data, onFileSelect: () => {}, onPublish: () => {} }));
}

test("Import.tsx (no preview, no status - the default state) renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const data = computeImportData(seed, new Set(), null, null, "", false);
  const actual = renderImportHtml(data);
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/import.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Import.tsx's rendered output no longer matches tests/snapshots/import.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const data = computeImportData(seed, new Set(), null, null, "", false);
  const html = renderImportHtml(data);
  assert.match(html, /import-panel/);
  assert.match(html, /Import updated spreadsheet/);
  assert.match(html, /synthetic-rows\.json \(tests\/fixtures\)/);
});

test("an import-status message renders inside .import-status, and is absent when there is none", () => {
  const seed = loadSeed();
  const withStatus = renderImportHtml(computeImportData(seed, new Set(), null, null, "Preview ready. Review the counts, then publish when it looks right.", false));
  assert.match(withStatus, /<div class="import-status">Preview ready\. Review the counts, then publish when it looks right\.<\/div>/);

  const withoutStatus = renderImportHtml(computeImportData(seed, new Set(), null, null, "", false));
  assert.doesNotMatch(withoutStatus, /import-status/);
});

test("the preview block renders the file name, sheet name, all five summary counts, and the checklist - absent entirely with no preview", () => {
  const seed = loadSeed();
  const preview = { seed, sheetName: "Mailing Schedule", rowCount: 42, fileName: "updated-schedule.xlsx" };
  const data = computeImportData(seed, new Set(), null, preview, "Preview ready.", false);
  const html = renderImportHtml(data);

  assert.match(html, /import-preview/);
  assert.match(html, /Preview before publishing/);
  assert.match(html, /updated-schedule\.xlsx - Mailing Schedule/);
  assert.match(html, /Rows read<\/span><strong>42<\/strong>/);
  assert.match(html, new RegExp(`Subscribers</span><strong>${seed.summary.subscriberCount}</strong>`));
  assert.match(html, new RegExp(`Mailings</span><strong>${seed.summary.mailingCount}</strong>`));
  assert.match(html, new RegExp(`Open</span><strong>${seed.summary.openMailingCount}</strong>`));
  assert.match(html, new RegExp(`Needs Review</span><strong>${seed.summary.exceptionCount}</strong>`));
  assert.match(html, /Ashley will see this same imported data when she refreshes/);
  assert.match(html, /Existing CRM status clicks are preserved/);
  assert.match(html, /Bad dates, missing addresses, missing emails/);

  const noPreview = renderImportHtml(computeImportData(seed, new Set(), null, null, "", false));
  assert.doesNotMatch(noPreview, /import-preview/);
});

// The reconciliation panel is absent from the committed default-state
// snapshot (tests/snapshots/import.html) on purpose - it's driven by
// importInfo.importSummary, which is null until this session's own
// publish has actually returned a server response (see
// import-selectors.ts's own comment on why that's deliberately
// session-scoped, not reconstructed from anything durable). Proportionate
// targeted assertions here, matching the preview block's own test above,
// rather than a second frozen snapshot for markup nothing before this
// task ever rendered.
test("the import reconciliation panel renders rows/written/skipped and every skip group's reason, count, and sheet rows - absent with no importSummary", () => {
  const seed = loadSeed();
  const importSummary = {
    totalRows: 1218,
    mailingsWritten: 1197,
    skipped: [
      { reason: "Subscription has an unrecognized plan", count: 2, sourceRows: [1070, 1076] },
      { reason: "Mailing shares its order, character, and letter number with another row", count: 3, sourceRows: [309, 310, 311] },
    ],
  };
  const importInfo = { seed, sourceName: "Import_20260812_181828.xlsx", uploadedAt: "2026-08-12T18:32:00.000Z", summary: seed.summary, importSummary };
  const data = computeImportData(seed, new Set(), importInfo, null, "Imported. This is now the shared CRM data.", false);
  const html = renderImportHtml(data);

  assert.match(html, /import-reconciliation/);
  assert.match(html, /Import reconciliation/);
  assert.match(html, /Rows in file<\/span><strong>1,218<\/strong>/);
  assert.match(html, /Written<\/span><strong>1,197<\/strong>/);
  assert.match(html, /Skipped<\/span><strong>21<\/strong>/);
  assert.match(html, /Subscription has an unrecognized plan.*\(2\).*sheet rows: 1070, 1076/);
  assert.match(html, /Mailing shares its order, character, and letter number with another row.*\(3\).*sheet rows: 309, 310, 311/);
  assert.doesNotMatch(html, /Every row in the file was written/);

  const noSkips = renderImportHtml(
    computeImportData(seed, new Set(), { ...importInfo, importSummary: { totalRows: 5, mailingsWritten: 5, skipped: [] } }, null, "", false),
  );
  assert.match(noSkips, /Every row in the file was written\. Nothing was skipped\./);
  assert.doesNotMatch(noSkips, /import-skip-groups"/);

  const noImportSummary = renderImportHtml(computeImportData(seed, new Set(), null, null, "", false));
  assert.doesNotMatch(noImportSummary, /import-reconciliation/);
});

test("the publish button reads 'Publish to shared CRM' and is enabled when not busy, or 'Publishing...' and disabled when busy", () => {
  const seed = loadSeed();
  const preview = { seed, sheetName: "Sheet1", rowCount: 1, fileName: "test.xlsx" };

  const idle = renderImportHtml(computeImportData(seed, new Set(), null, preview, "", false));
  assert.match(idle, /<button type="button" id="publishImport">Publish to shared CRM<\/button>/);

  const busy = renderImportHtml(computeImportData(seed, new Set(), null, preview, "Publishing spreadsheet to the shared CRM...", true));
  assert.match(busy, /<button type="button" id="publishImport" disabled="">Publishing\.\.\.<\/button>/);
});

// Calling Import(props) directly (no ReactDOM) returns the real element
// tree - same technique steps 8-10 established. The file input's onChange
// and the publish button's onClick are both plain host elements here (no
// nested sub-component to expand, unlike step 10's ExceptionRow), so the
// original, unextended findAll from steps 8-9 is enough.
function findFirst(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findFirst(child, predicate);
      if (found) return found;
    }
    return null;
  }
  return findFirst(children, predicate);
}

test("the file input's real onChange calls onFileSelect with the chosen file (component-level, not just static output)", () => {
  const seed = loadSeed();
  const data = computeImportData(seed, new Set(), null, null, "", false);
  const calls = [];
  const element = Import({ data, onFileSelect: (file) => calls.push(file), onPublish: () => {} });

  const input = findFirst(element, (node) => node.type === "input" && node.props.id === "spreadsheetUpload");
  assert.ok(input, "spreadsheetUpload input not found in the rendered tree");
  assert.equal(input.props.type, "file");
  assert.equal(input.props.accept, ".xlsx,.xls,.csv");

  const fakeFile = { name: "chosen.xlsx" };
  input.props.onChange({ target: { files: [fakeFile] } });
  assert.deepEqual(calls, [fakeFile]);

  // No file selected (e.g. the picker was cancelled) must not call
  // onFileSelect at all - matches legacy's `if (!file) return;`.
  input.props.onChange({ target: { files: [] } });
  assert.equal(calls.length, 1, "an empty file list must not trigger a second call");
});

test("the publish button's real onClick calls onPublish with no arguments (component-level, not just static output)", () => {
  const seed = loadSeed();
  const preview = { seed, sheetName: "Sheet1", rowCount: 1, fileName: "test.xlsx" };
  const data = computeImportData(seed, new Set(), null, preview, "", false);
  let calls = 0;
  const element = Import({ data, onFileSelect: () => {}, onPublish: () => (calls += 1) });

  const button = findFirst(element, (node) => node.type === "button" && node.props.id === "publishImport");
  assert.ok(button, "publishImport button not found in the rendered tree");
  button.props.onClick();
  assert.equal(calls, 1);
});
