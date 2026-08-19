import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLetterNumber, stableMailingId, findMailingCollisions } from "../lib/domain/mailing-collision.ts";

test("normalizeLetterNumber returns null for '', null, and undefined - not 0, since Number('') === 0", () => {
  assert.equal(normalizeLetterNumber(""), null);
  assert.equal(normalizeLetterNumber(null), null);
  assert.equal(normalizeLetterNumber(undefined), null);
});

test("normalizeLetterNumber returns a real number for a numeric-looking value, string or number", () => {
  assert.equal(normalizeLetterNumber("4"), 4);
  assert.equal(normalizeLetterNumber(4), 4);
  assert.equal(normalizeLetterNumber("0"), 0, "letter number zero is a real, distinct value from 'no letter number'");
});

test("normalizeLetterNumber returns null for a non-numeric string rather than NaN", () => {
  assert.equal(normalizeLetterNumber("not a number"), null);
});

test("stableMailingId joins orderId::character::letterNumber, empty string for a missing letter number", () => {
  assert.equal(stableMailingId({ orderId: "ORD-2858", character: "Marley", letterNumber: "4" }), "ORD-2858::Marley::4");
  assert.equal(stableMailingId({ orderId: "ORD-2858", character: "Marley", letterNumber: "" }), "ORD-2858::Marley::");
  assert.equal(stableMailingId({ orderId: "ORD-2858", character: "Marley" }), "ORD-2858::Marley::");
});

test("stableMailingId distinguishes letter number 0 from a missing letter number", () => {
  assert.notEqual(stableMailingId({ orderId: "ORD-1", character: "Piper", letterNumber: "0" }), stableMailingId({ orderId: "ORD-1", character: "Piper", letterNumber: "" }));
});

test("findMailingCollisions groups the real 3-row fixture (rows 309/310/311, order 2858, character Marley, letter number 4) into one group", () => {
  const mailings = [
    { sourceRow: 309, orderId: "ORD-2858", character: "Marley", letterNumber: "4" },
    { sourceRow: 310, orderId: "ORD-2858", character: "Marley", letterNumber: "4" },
    { sourceRow: 311, orderId: "ORD-2858", character: "Marley", letterNumber: "4" },
  ];
  const groups = findMailingCollisions(mailings);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].stableId, "ORD-2858::Marley::4");
  assert.deepEqual(
    groups[0].mailings.map((m) => m.sourceRow),
    [309, 310, 311],
  );
});

test("findMailingCollisions returns no groups when every mailing has a distinct stable id", () => {
  const mailings = [
    { sourceRow: 1, orderId: "ORD-1", character: "Marley", letterNumber: "1" },
    { sourceRow: 2, orderId: "ORD-1", character: "Marley", letterNumber: "2" },
    { sourceRow: 3, orderId: "ORD-2", character: "Marley", letterNumber: "1" },
    { sourceRow: 4, orderId: "ORD-1", character: "Piper", letterNumber: "1" },
  ];
  assert.deepEqual(findMailingCollisions(mailings), []);
});

test("findMailingCollisions handles multiple independent collision groups in one pass", () => {
  const mailings = [
    { sourceRow: 1, orderId: "ORD-1", character: "Marley", letterNumber: "1" },
    { sourceRow: 2, orderId: "ORD-1", character: "Marley", letterNumber: "1" },
    { sourceRow: 3, orderId: "ORD-2", character: "Piper", letterNumber: "3" },
    { sourceRow: 4, orderId: "ORD-2", character: "Piper", letterNumber: "3" },
    { sourceRow: 5, orderId: "ORD-3", character: "Marley", letterNumber: "1" },
  ];
  const groups = findMailingCollisions(mailings);
  assert.equal(groups.length, 2);
});
