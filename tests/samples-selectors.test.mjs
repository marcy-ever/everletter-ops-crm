// Coverage for app/crm/views/samples/samples-selectors.ts's
// computeSamplesData() - Phase 1 step 9 (CLAUDE.md). sampleType drives
// three separate parts of Samples.tsx's rendered output (the toggle's
// active class, the Mailchimp tag, and sampleRows' Selected/Ready status)
// - this file exercises computeSamplesData() directly for both values, so
// tests/samples-view.test.mjs's own equivalence coverage isn't the only
// place either value is exercised.
import assert from "node:assert/strict";
import test from "node:test";
import { computeSamplesData, SAMPLE_ASSETS, SAMPLE_FLOWS } from "../app/crm/views/samples/samples-selectors.ts";

test("computeSamplesData('Kid') marks the Kid row Selected and the Adult row Ready", () => {
  const data = computeSamplesData("Kid");
  assert.equal(data.sampleType, "Kid");
  const kidRow = data.sampleRows.find((row) => row.type === "Kid");
  const adultRow = data.sampleRows.find((row) => row.type === "Adult");
  assert.equal(kidRow.status, "Selected");
  assert.equal(adultRow.status, "Ready");
});

test("computeSamplesData('Adult') marks the Adult row Selected and the Kid row Ready", () => {
  const data = computeSamplesData("Adult");
  assert.equal(data.sampleType, "Adult");
  const kidRow = data.sampleRows.find((row) => row.type === "Kid");
  const adultRow = data.sampleRows.find((row) => row.type === "Adult");
  assert.equal(kidRow.status, "Ready");
  assert.equal(adultRow.status, "Selected");
});

test("sampleRows always has exactly one Kid row and one Adult row, tag/template unaffected by sampleType", () => {
  for (const sampleType of ["Kid", "Adult"]) {
    const data = computeSamplesData(sampleType);
    assert.equal(data.sampleRows.length, 2);
    const kidRow = data.sampleRows.find((row) => row.type === "Kid");
    const adultRow = data.sampleRows.find((row) => row.type === "Adult");
    assert.equal(kidRow.tag, "sample-kid");
    assert.equal(kidRow.template, "Kid sample letter");
    assert.equal(adultRow.tag, "sample-adult");
    assert.equal(adultRow.template, "Adult sample letter");
  }
});

test("sampleAssets/flows are the same reference regardless of sampleType - static content, not recomputed", () => {
  const kid = computeSamplesData("Kid");
  const adult = computeSamplesData("Adult");
  assert.equal(kid.sampleAssets, SAMPLE_ASSETS);
  assert.equal(adult.sampleAssets, SAMPLE_ASSETS);
  assert.equal(kid.flows, SAMPLE_FLOWS);
  assert.equal(adult.flows, SAMPLE_FLOWS);
});

test("SAMPLE_ASSETS has exactly 2 Kid and 2 Adult entries, each with a non-empty file/title/note", () => {
  assert.equal(SAMPLE_ASSETS.length, 4);
  assert.equal(SAMPLE_ASSETS.filter((asset) => asset.type === "Kid").length, 2);
  assert.equal(SAMPLE_ASSETS.filter((asset) => asset.type === "Adult").length, 2);
  for (const asset of SAMPLE_ASSETS) {
    assert.ok(asset.file, `${asset.title} is missing a file path`);
    assert.ok(asset.title, "an asset is missing a title");
    assert.ok(asset.note, `${asset.title} is missing a note`);
  }
});

test("SAMPLE_FLOWS has exactly 5 steps, in order, each with a title and detail", () => {
  assert.equal(SAMPLE_FLOWS.length, 5);
  assert.deepEqual(
    SAMPLE_FLOWS.map((step) => step.title),
    ["Request captured", "Lead created", "Mailchimp tagged", "Sample sent", "Conversion matched"],
  );
  for (const step of SAMPLE_FLOWS) {
    assert.ok(step.detail, `${step.title} is missing a detail`);
  }
});

test("computeSamplesData is deterministic - same sampleType, same output, called twice", () => {
  const a = computeSamplesData("Kid");
  const b = computeSamplesData("Kid");
  assert.deepEqual(a, b);
});
