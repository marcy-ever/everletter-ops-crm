import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCharacter, driveCharacterKey, letterNumberKey, envelopeStockForCharacter } from "../lib/domain/characters.ts";

// New coverage from step 3b's extraction (lib/domain/characters.ts didn't
// exist before this) - not a re-assertion of what the render snapshots
// already cover. envelopeStockForCharacter added in step 3c, when it
// moved here from app/crm/legacy-app.js.

test("normalizeCharacter recognizes a known character embedded in longer spreadsheet text", () => {
  assert.equal(normalizeCharacter("Marley"), "Marley");
  assert.equal(normalizeCharacter("RINGO kid"), "Ringo");
});

test("normalizeCharacter treats 'old marley' as a distinct character identity, not a substring match on 'marley'", () => {
  assert.equal(normalizeCharacter("old marley"), "Old Marley");
  assert.equal(normalizeCharacter("Old Marley - returning"), "Old Marley");
});

test("normalizeCharacter falls back to 'Needs Review' for blank input, and to the raw trimmed string for an unrecognized character", () => {
  assert.equal(normalizeCharacter(""), "Needs Review");
  assert.equal(normalizeCharacter(null), "Needs Review");
  assert.equal(normalizeCharacter(undefined), "Needs Review");
  assert.equal(normalizeCharacter("   "), "Needs Review");
  assert.equal(normalizeCharacter("Mystery Character"), "Mystery Character");
});

test("driveCharacterKey strips a leading new/old qualifier and lowercases, so New Marley/Old Marley/Marley share one Drive-config key", () => {
  assert.equal(driveCharacterKey("Marley"), "marley");
  assert.equal(driveCharacterKey("New Marley"), "marley");
  assert.equal(driveCharacterKey("Old Marley"), "marley");
  assert.equal(driveCharacterKey("  Ringo  "), "ringo");
});

test("driveCharacterKey returns an empty string for blank/missing input", () => {
  assert.equal(driveCharacterKey(""), "");
  assert.equal(driveCharacterKey(null), "");
  assert.equal(driveCharacterKey(undefined), "");
});

test("letterNumberKey stringifies a real number", () => {
  assert.equal(letterNumberKey("3"), "3");
  assert.equal(letterNumberKey(7), "7");
});

test("letterNumberKey treats '' and null as the number 0, not as missing - a real JS Number() coercion quirk worth locking, not assuming", () => {
  // Number("") === 0 and Number(null) === 0 in JS, and both are finite, so
  // letterNumberKey("") and letterNumberKey(null) both return "0" - not ""
  // the way you might expect "blank input" to behave. undefined and
  // non-numeric text genuinely aren't finite numbers, so those do return "".
  assert.equal(letterNumberKey(""), "0");
  assert.equal(letterNumberKey(null), "0");
});

test("letterNumberKey returns an empty string for undefined or non-numeric text", () => {
  assert.equal(letterNumberKey(undefined), "");
  assert.equal(letterNumberKey("abc"), "");
});

test("envelopeStockForCharacter gives each kid character its own colored envelope", () => {
  assert.equal(envelopeStockForCharacter("Marley"), "Marley color envelope");
  assert.equal(envelopeStockForCharacter("Ringo"), "Ringo color envelope");
  assert.equal(envelopeStockForCharacter("Oliver"), "Oliver color envelope");
  assert.equal(envelopeStockForCharacter("Harper"), "Harper color envelope");
});

test("envelopeStockForCharacter falls back to the shared adult standard stock for every non-kid character", () => {
  assert.equal(envelopeStockForCharacter("Penelope"), "Adult standard envelope");
  assert.equal(envelopeStockForCharacter("Seraphine"), "Adult standard envelope");
  assert.equal(envelopeStockForCharacter("Legends"), "Adult standard envelope");
  assert.equal(envelopeStockForCharacter("Marigold"), "Adult standard envelope");
  assert.equal(envelopeStockForCharacter(""), "Adult standard envelope");
});

test("envelopeStockForCharacter groups Old Marley with Marley (via driveCharacterKey's new/old stripping), not as its own stock", () => {
  assert.equal(envelopeStockForCharacter("Old Marley"), "Marley color envelope");
});
