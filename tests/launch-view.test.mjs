// Proves app/crm/views/launch-plan/LaunchPlan.tsx - the second view
// migrated to React (Phase 1, step 7 of the app.js decomposition -
// CLAUDE.md) - still produces the same markup as the legacy
// renderLaunch()/launchItem() it replaced (removed from
// app/crm/legacy-app.js by this same change).
//
// Reuses tests/html-normalize.mjs's rules exactly, as instructed - see
// that module's own header for why byte-identity isn't achievable and
// what the three normalization rules do and don't paper over. Nothing
// new here: this file only supplies view-specific data (the checklist),
// same shape as tests/automation-view.test.mjs.
//
// The launch data has to be computed with the exact same inputs the
// frozen tests/snapshots/launch.html was rendered from - see
// tests/render-snapshots.test.mjs's own fixtures (seed, FIXED_NOW) and
// caseState() defaults (batchFilter: "all", packetScope: "monthly",
// query: "") for where these values come from; duplicated here rather
// than imported since render-snapshots.test.mjs doesn't export them and
// this is the one place outside that file anything needs them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LaunchPlan from "../app/crm/views/launch-plan/LaunchPlan.tsx";
import { computeLaunchPlanData } from "../app/crm/views/launch-plan/launch-selectors.ts";
import { effectiveMailings } from "../lib/client/selectors.ts";
import { todayIso } from "../lib/domain/mailing-rules.ts";
import { buildSeedFromSpreadsheet } from "../lib/domain/spreadsheet/build-seed.ts";
import { normalizeHtml } from "./html-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same UTC-noon instant and synthetic fixture tests/render-snapshots.test.mjs
// pins (see that file's own module comment for why UTC noon specifically) -
// tests/snapshots/launch.html was rendered against this exact data, so
// this file has to reconstruct it exactly, not approximate it.
const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z");

function loadLaunchData() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/synthetic-rows.json"), "utf8"));
  const seed = buildSeedFromSpreadsheet(rows, "synthetic-rows.json (tests/fixtures)", FIXED_NOW, []);
  const mailings = effectiveMailings(seed, {});
  // caseState()'s own defaults in tests/render-snapshots.test.mjs:
  // batchFilter "all", packetScope "all", query "" - the launch case
  // itself doesn't override any of these, so these ARE the values
  // tests/snapshots/launch.html was actually rendered under.
  return computeLaunchPlanData(seed, mailings, new Set(), {}, "all", "all", "", todayIso(FIXED_NOW));
}

test("LaunchPlan.tsx renders markup equivalent to the frozen legacy snapshot, under the same normalized comparison Automation.tsx uses", () => {
  const data = loadLaunchData();
  const actual = renderToStaticMarkup(React.createElement(LaunchPlan, { data }));
  const expected = fs.readFileSync(path.join(ROOT, "tests/snapshots/launch.html"), "utf8");

  assert.equal(
    normalizeHtml(actual),
    normalizeHtml(expected),
    "LaunchPlan.tsx's rendered output no longer matches tests/snapshots/launch.html under the normalized comparison - a real markup/attribute/text difference, not just whitespace (see tests/html-normalize.mjs for exactly what the normalization does and doesn't remove).",
  );
});

test("the real component output actually contains computed data, not just an empty-vs-empty pass", () => {
  const data = loadLaunchData();
  const html = renderToStaticMarkup(React.createElement(LaunchPlan, { data }));
  assert.match(html, /launch-layout/);
  assert.match(html, /Go-live checklist/);
  assert.match(html, /high exceptions/);
  assert.match(html, /launch-roadmap/);
});
