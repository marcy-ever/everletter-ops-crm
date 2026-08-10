import assert from "node:assert/strict";
import test from "node:test";
import { parseAllowedUsers, getRoleForEmail } from "../lib/allowlist.ts";

test("parses well-formed email:role pairs", () => {
  const allowlist = parseAllowedUsers("marcy@example.com:owner,ashley@example.com:staff");
  assert.equal(allowlist.get("marcy@example.com"), "owner");
  assert.equal(allowlist.get("ashley@example.com"), "staff");
  assert.equal(allowlist.size, 2);
});

test("normalizes email case but not role case", () => {
  const allowlist = parseAllowedUsers("Marcy@Example.com:Owner");
  assert.equal(allowlist.get("marcy@example.com"), "Owner");
  assert.equal(allowlist.has("Marcy@Example.com"), false);
});

test("tolerates surrounding whitespace", () => {
  const allowlist = parseAllowedUsers(" marcy@example.com : owner , ashley@example.com : staff ");
  assert.equal(allowlist.get("marcy@example.com"), "owner");
  assert.equal(allowlist.get("ashley@example.com"), "staff");
});

test("skips malformed entries instead of throwing", () => {
  const allowlist = parseAllowedUsers("marcy@example.com:owner,no-colon-here,:missing-email,trailing-colon:,,");
  assert.equal(allowlist.size, 1);
  assert.equal(allowlist.get("marcy@example.com"), "owner");
});

test("returns an empty map for undefined/null/empty input", () => {
  assert.equal(parseAllowedUsers(undefined).size, 0);
  assert.equal(parseAllowedUsers(null).size, 0);
  assert.equal(parseAllowedUsers("").size, 0);
});

test("getRoleForEmail resolves a matched email to its role", () => {
  const raw = "marcy@example.com:owner,ashley@example.com:staff";
  assert.equal(getRoleForEmail("marcy@example.com", raw), "owner");
  assert.equal(getRoleForEmail("ashley@example.com", raw), "staff");
});

test("getRoleForEmail is case-insensitive on the email", () => {
  const raw = "marcy@example.com:owner";
  assert.equal(getRoleForEmail("MARCY@EXAMPLE.COM", raw), "owner");
});

test("getRoleForEmail returns null for an unlisted email", () => {
  const raw = "marcy@example.com:owner";
  assert.equal(getRoleForEmail("stranger@example.com", raw), null);
});

test("getRoleForEmail returns null for a missing/empty email", () => {
  const raw = "marcy@example.com:owner";
  assert.equal(getRoleForEmail(null, raw), null);
  assert.equal(getRoleForEmail(undefined, raw), null);
  assert.equal(getRoleForEmail("", raw), null);
});
