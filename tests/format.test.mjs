import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, formatDate, includesText, statusClass, number, titleCase } from "../app/crm/format.ts";

// New coverage from step 3b's extraction (app/crm/format.ts didn't exist
// before this) - not a re-assertion of what the render snapshots already
// cover. All expected values below were captured by actually running the
// (unchanged) implementation, not hand-computed.

test("escapeHtml escapes all five HTML-significant characters", () => {
  assert.equal(
    escapeHtml("<script>alert('x')</script> & \"quotes\""),
    "&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt; &amp; &quot;quotes&quot;",
  );
});

test("escapeHtml treats null/undefined as an empty string, not the literal text \"null\"", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("formatDate renders a real ISO date as 'Mon D, YYYY'", () => {
  assert.equal(formatDate("2026-08-15"), "Aug 15, 2026");
});

test("formatDate returns 'Needs date' for blank/missing input, not an Invalid Date string", () => {
  assert.equal(formatDate(""), "Needs date");
  assert.equal(formatDate(null), "Needs date");
  assert.equal(formatDate(undefined), "Needs date");
});

test("includesText matches case-insensitively against any of the given values", () => {
  assert.equal(includesText(["Marley", "Ringo"], "marl"), true);
  assert.equal(includesText(["Marley", "Ringo"], "zzz"), false);
});

test("includesText treats a blank/whitespace-only query as matching everything", () => {
  assert.equal(includesText(["Marley", "Ringo"], ""), true);
  assert.equal(includesText(["Marley", "Ringo"], "   "), true);
});

test("statusClass lowercases and replaces non-alphanumeric runs with a single hyphen, for use as a CSS class", () => {
  assert.equal(statusClass("To Prepare"), "to-prepare");
  assert.equal(statusClass("Ready to Mail"), "ready-to-mail");
});

test("number formats with locale thousands separators, defaulting missing/blank input to 0", () => {
  assert.equal(number(1234), "1,234");
  assert.equal(number(0), "0");
  assert.equal(number(null), "0");
  assert.equal(number(""), "0");
});

test("titleCase capitalizes the first letter of each whitespace-separated word, lowercasing the rest", () => {
  assert.equal(titleCase("MARLEY the BRAVE"), "Marley The Brave");
});

test("titleCase returns an empty string for blank/missing input", () => {
  assert.equal(titleCase(""), "");
  assert.equal(titleCase(null), "");
});
