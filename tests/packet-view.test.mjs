// Proves app/crm/views/packet/Packet.tsx - the tenth view migrated to
// React (Phase 1 step 15 of the app.js decomposition - CLAUDE.md), and the
// largest snapshot in the whole suite - still produces the same markup as
// the legacy renderPacket()/packetWorkCard()/packetChecklistCard()/
// packetProblemRow()/packetFinalRow()/binMobileCard() it replaced (removed
// from app/crm/legacy-app.js by this same change).
//
// Equivalence coverage reuses tests/html-normalize.mjs exactly, against
// the one frozen snapshot (tests/snapshots/packet.html), which covers both
// the desktop tables AND the mobile card list in a single capture - unlike
// Production Queue (step 13), Packet never had separate filter-variant
// snapshots, so this file's own "scope toggle composes correctly" test
// below is what proves that composition.
//
// The mobile card selects were deliberately inert through step 15 (a
// real, pre-existing gap: legacy never wired a change listener for them
// either, and a fix would have been invisible to this file's own
// snapshot proof - see Packet.tsx's own header). Wired for real in step
// 16 (Ashley Bins, second commit) - a deliberate, separately-reviewed
// behavior change the snapshot test above still can't see (it stays
// green either way). This file's own test below proves the component-level
// wiring; tests/packet-bins-select-parity.test.mjs proves it writes the
// same key/value shape Bins' own reference handler would;
// tests/bins-write-path.e2e.test.mjs proves the shared handler itself
// against a real Postgres.
//
// The print/envelope/Drive actions' write paths ARE real and testable
// here at the component level (their real onClick calls) - no e2e file
// needed for them, since they're pure browser actions with no server
// round trip.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Packet from "../app/crm/views/packet/Packet.tsx";
import { computePacketData } from "../app/crm/views/packet/packet-selectors.ts";
import { componentStatus } from "../lib/client/selectors.ts";
import { envelopeQuantityForMailing } from "../lib/domain/plans.ts";
import { mailingKey } from "../lib/domain/keys.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant tests/render-snapshots.test.mjs pins (see that
// file's own module comment for why). letterFolderUrl reproduces the real,
// always-empty behavior (no real Drive folder IDs are ever committed to
// this repo - see CLAUDE.md's data-boundary note), same as
// tests/qa-view.test.mjs's own stub.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");
const TODAY = "2026-08-12";
const NO_LETTER_FOLDER = () => "";

// A real, working reproduction of legacy's own envelopePrintRows(rows) -
// filter to componentStatus 'envelope' === 'Need Print', one array entry
// per envelope-quantity unit - not a bare stub, since its COUNT (not just
// presence) appears twice in the rendered snapshot text (the "Need print
// now" stat and the Marcy checklist's first line).
function realEnvelopePrintRows(seed, reviewed) {
  return (rows) =>
    rows
      .filter((mailing) => componentStatus(mailing, "envelope", seed, reviewed, {}) === "Need Print")
      .flatMap((mailing) => Array.from({ length: envelopeQuantityForMailing(mailing) }, () => mailing));
}

function loadSeed() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  return buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
}

const NOOP = () => {};

function renderPacketHtml(seed, { batchFilter = "all", packetScope = "all", query = "" } = {}) {
  const reviewed = new Set();
  const data = computePacketData(seed, {}, reviewed, {}, batchFilter, packetScope, query, TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed));
  return renderToStaticMarkup(
    React.createElement(Packet, {
      data,
      packetScope,
      printReadyFolderUrl: "",
      onScopeChange: NOOP,
      onFieldChange: NOOP,
      onPrint: NOOP,
      onPrintEnvelopes: NOOP,
      onOpenDriveLink: NOOP,
    }),
  );
}

test("Packet.tsx (default: batchFilter 'all', packetScope 'all', no query) renders markup equivalent to the frozen legacy snapshot", () => {
  const seed = loadSeed();
  const actual = renderPacketHtml(seed);
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/packet.html"), "utf8");
  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "Packet.tsx's rendered output no longer matches tests/snapshots/packet.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs).",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const seed = loadSeed();
  const html = renderPacketHtml(seed);
  assert.match(html, /data-packet-print/);
  assert.match(html, /data-packet-envelopes/);
  assert.match(html, /data-drive-url=""/);
  assert.match(html, /data-bin-select="MAIL-[^"]+::field::envelope"/);
  assert.match(html, /Batch Packet/);
});

// Moved from tests/render-snapshots.test.mjs (step 15's own migration) -
// that file's neighboring "Ashley Bins has no mobile cards" test (step 1's
// original finding) stays there since Bins is still legacy; this half now
// checks Packet.tsx's own real output instead of the legacy sandbox, since
// #viewMount is deliberately empty for a react-hosted view.
test("Batch Packet renders both the desktop table and the mobile card list (the markup the original Bins task description expected to find in Bins)", () => {
  const seed = loadSeed();
  const html = renderPacketHtml(seed);
  assert.match(html, /<table class="packet-table packet-final-table">/, "expected the desktop final-mailing-rows table");
  assert.match(html, /class="mobile-card-list bins-mobile-cards"/, "expected the mobile card list container");
});

test("the scope toggle composes with the search box and batch filter (Packet has no separate filter-variant snapshots, unlike Production Queue)", () => {
  const seed = loadSeed();
  const reviewed = new Set();
  const all = computePacketData(seed, {}, reviewed, {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed)).rows;
  const scoped = computePacketData(seed, {}, reviewed, {}, "all", "monthly", "", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed)).rows;
  const searched = computePacketData(seed, {}, reviewed, {}, "all", "all", "Ringo", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed)).rows;
  const batchFiltered = computePacketData(seed, {}, reviewed, {}, "2026-08-15", "all", "", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed)).rows;
  const combined = computePacketData(seed, {}, reviewed, {}, "2026-08-15", "monthly", "Ringo", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed)).rows;

  assert.ok(scoped.length < all.length, "the scope toggle must narrow the result set");
  assert.ok(searched.length < all.length, "search must narrow the result set");
  assert.ok(batchFiltered.length < all.length, "the batch filter must narrow the result set");
  assert.ok(combined.length <= Math.min(scoped.length, searched.length, batchFiltered.length));
});

// Depth-first search through a React element tree - same technique steps
// 10-14 established, extended in step 13 to handle a children array nested
// inside another array. Reused verbatim here.
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
  const reviewed = new Set();
  const data = computePacketData(seed, {}, reviewed, {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed));
  const calls = [];
  const element = Packet({ data, packetScope: "all", printReadyFolderUrl: "", onScopeChange: (scope) => calls.push(scope), onFieldChange: NOOP, onPrint: NOOP, onPrintEnvelopes: NOOP, onOpenDriveLink: NOOP });

  const scopeButtons = findAll(element, (node) => node.type === "button" && node.props["data-packet-scope"] !== undefined);
  assert.equal(scopeButtons.length, 2);
  for (const button of scopeButtons) button.props.onClick();
  assert.deepEqual(calls, ["all", "monthly"]);
});

test("print/envelope/Drive actions' real onClick call their own callback with the expected argument", () => {
  const seed = loadSeed();
  const reviewed = new Set();
  const data = computePacketData(seed, {}, reviewed, {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed));
  let printCalls = 0;
  let envelopeCalls = 0;
  const driveUrls = [];
  const element = Packet({
    data,
    packetScope: "all",
    printReadyFolderUrl: "",
    onScopeChange: NOOP,
    onFieldChange: NOOP,
    onPrint: () => (printCalls += 1),
    onPrintEnvelopes: () => (envelopeCalls += 1),
    onOpenDriveLink: (url) => driveUrls.push(url),
  });

  findAll(element, (node) => node.type === "button" && node.props["data-packet-print"] !== undefined)[0].props.onClick();
  findAll(element, (node) => node.type === "button" && node.props["data-packet-envelopes"] !== undefined)[0].props.onClick();
  findAll(element, (node) => node.type === "button" && node.props["data-drive-url"] !== undefined)[0].props.onClick();

  assert.equal(printCalls, 1);
  assert.equal(envelopeCalls, 1);
  assert.deepEqual(driveUrls, [""], "no real Drive folder URL is ever committed to this repo - reproduces the empty-URL alert path exactly");
});

// As of step 16 (Ashley Bins, second commit), the mobile card's three
// selects are wired for real - see Packet.tsx's own header and
// CrmApp.tsx's REACT_VIEWS.packet comment for why this is a deliberate,
// separately-reviewed behavior change the snapshot gate above can't see
// (packet.html stays byte-identical either way). This test proves the
// component-level wiring is real; tests/packet-bins-select-parity.test.mjs
// proves it writes the identical key/value shape Bins' own reference
// handler would for the equivalent row; tests/bins-write-path.e2e.test.mjs
// proves the shared handler itself against a real Postgres.
test("each mobile card's real onChange calls onFieldChange with that row's exact mailing, the field key, and the selected value", () => {
  const seed = loadSeed();
  const reviewed = new Set();
  const data = computePacketData(seed, {}, reviewed, {}, "all", "all", "", TODAY, NO_LETTER_FOLDER, realEnvelopePrintRows(seed, reviewed));
  assert.ok(data.mobileRows.length > 0, "fixture invariant: at least one row should be shown by default");
  const calls = [];
  const element = Packet({
    data,
    packetScope: "all",
    printReadyFolderUrl: "",
    onScopeChange: NOOP,
    onFieldChange: (mailing, field, value) => calls.push([mailing, field, value]),
    onPrint: NOOP,
    onPrintEnvelopes: NOOP,
    onOpenDriveLink: NOOP,
  });

  const selects = findAll(element, (node) => node.type === "select" && node.props["data-bin-select"] !== undefined);
  assert.equal(selects.length, data.mobileRows.length * 3, "three fields (envelope/letter/location) per mobile card");

  selects[0].props.onChange({ target: { value: "Printed" } });
  assert.equal(calls.length, 1);
  assert.equal(mailingKey(calls[0][0]), mailingKey(data.mobileRows[0].mailing));
  assert.equal(calls[0][1], "envelope", "the first select column is always the envelope field");
  assert.equal(calls[0][2], "Printed");
});
