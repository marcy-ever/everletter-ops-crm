import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, includesText, statusClass, number } from "../app/crm/format.ts";

// New coverage from step 3b's extraction (app/crm/format.ts didn't exist
// before this) - not a re-assertion of what the render snapshots already
// cover. All expected values below were captured by actually running the
// (unchanged) implementation, not hand-computed.
//
// formatDate/titleCase moved out to lib/domain/format.ts in step 3c (see
// tests/domain-format.test.mjs) once storageBinForMailing/
// envelopeStockForCharacter, which depend on them, turned out to be real
// domain logic rather than display chrome.

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
