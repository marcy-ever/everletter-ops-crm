import assert from "node:assert/strict";
import test from "node:test";
import { matchEnvelopeNames } from "../lib/domain/photo-name-matching.ts";

const candidates = [
  { id: "1", recipientName: "Miya Thomas" },
  { id: "2", recipientName: "Karson Booth" },
  { id: "3", recipientName: "Audrey Eleanor" },
];

test("full OCR names are safe automatic matches", () => {
  const matches = matchEnvelopeNames("Miya Thomas 12410 County Road\nAudrey Eleanor 9023 Clipper Drive", candidates);
  assert.deepEqual(matches.map((item) => [item.id, item.confidence]), [["1", "clear"], ["3", "clear"]]);
});

test("partial names are review matches and unrelated names are ignored", () => {
  const matches = matchEnvelopeNames("Karsen Booth\nSomeone Else", candidates);
  assert.deepEqual(matches.map((item) => [item.id, item.confidence]), [["2", "review"]]);
});

test("a partly misread name becomes a clear match when its address also agrees", () => {
  const matches = matchEnvelopeNames("Karsen Booth 18 Old Brazzil Trl Pinedale WY 82941", [
    { id: "2", recipientName: "Karson Booth", address: "18 Old Brazzil Trl Pinedale WY 82941" },
  ]);
  assert.deepEqual(matches.map((item) => [item.id, item.confidence]), [["2", "clear"]]);
});
