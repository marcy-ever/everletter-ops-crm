import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, titleCase } from "../lib/domain/format.ts";

// formatDate/titleCase moved here from app/crm/format.ts in step 3c: once
// storageBinForMailing (lib/domain/batch-dates.ts) and
// envelopeStockForCharacter (lib/domain/characters.ts) turned out to be
// real domain logic depending on these, the formatting primitives moved
// with them rather than leaving the two functions stranded. Test bodies
// unchanged from tests/format.test.mjs - only the import path and file
// moved.

test("formatDate renders a real ISO date as 'Mon D, YYYY'", () => {
  assert.equal(formatDate("2026-08-15"), "Aug 15, 2026");
});

test("formatDate returns 'Needs date' for blank/missing input, not an Invalid Date string", () => {
  assert.equal(formatDate(""), "Needs date");
  assert.equal(formatDate(null), "Needs date");
  assert.equal(formatDate(undefined), "Needs date");
});

test("titleCase capitalizes the first letter of each whitespace-separated word, lowercasing the rest", () => {
  assert.equal(titleCase("MARLEY the BRAVE"), "Marley The Brave");
});

test("titleCase returns an empty string for blank/missing input", () => {
  assert.equal(titleCase(""), "");
  assert.equal(titleCase(null), "");
});
