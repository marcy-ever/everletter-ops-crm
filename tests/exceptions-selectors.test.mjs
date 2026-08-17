// Coverage for app/crm/views/exceptions/exceptions-selectors.ts's
// computeExceptionRows() - Phase 1 step 10 (CLAUDE.md). Deliberately thin
// coverage matching the module's own thinness: the real filtering logic
// (activeExceptions/includesText) is already covered by
// tests/selectors.test.mjs, so this file only proves the composition -
// the field list actually searched, the reviewed-set exclusion, the
// 120-row cap, and determinism.
import assert from "node:assert/strict";
import test from "node:test";
import { computeExceptionRows } from "../app/crm/views/exceptions/exceptions-selectors.ts";

function exception(overrides = {}) {
  return {
    exceptionId: "EXC-1",
    severity: "High",
    reason: "Missing email",
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    recipientName: "Ava Example",
    shipDate: "2026-08-15",
    suggestedShipDate: "",
    status: "To Prepare",
    sourceRow: 5,
    ...overrides,
  };
}

function seedWith(exceptions) {
  return { subscribers: [], recipients: [], subscriptions: [], orders: [], mailings: [], exceptions, automationRules: [], summary: {} };
}

test("computeExceptionRows excludes a reviewed exception (by its review key)", () => {
  const item = exception();
  const seed = seedWith([item]);
  const reviewed = new Set(["MAIL-1::SUB-1::Missing email::2026-08-15"]);
  assert.deepEqual(computeExceptionRows(seed, reviewed, ""), []);
});

test("computeExceptionRows includes an unreviewed exception", () => {
  const item = exception();
  const seed = seedWith([item]);
  assert.deepEqual(computeExceptionRows(seed, new Set(), ""), [item]);
});

test("computeExceptionRows searches recipientName/reason/mailingId/status/severity, and only those fields", () => {
  const item = exception();
  const seed = seedWith([item]);
  for (const query of ["Ava Example", "Missing email", "MAIL-1", "To Prepare", "High"]) {
    assert.deepEqual(computeExceptionRows(seed, new Set(), query), [item], `query "${query}" should match`);
  }
  // subscriberId isn't in the searched field list - a query matching only
  // that should find nothing, proving the field list is exactly the five
  // legacy renderExceptions() searched, not "everything."
  assert.deepEqual(computeExceptionRows(seed, new Set(), "SUB-1"), []);
});

test("computeExceptionRows caps at 120 rows", () => {
  const items = Array.from({ length: 130 }, (_, i) => exception({ exceptionId: `EXC-${i}`, mailingId: `MAIL-${i}` }));
  const seed = seedWith(items);
  assert.equal(computeExceptionRows(seed, new Set(), "").length, 120);
});

test("computeExceptionRows is deterministic - same inputs, same output, called twice", () => {
  const seed = seedWith([exception(), exception({ exceptionId: "EXC-2", mailingId: "MAIL-2" })]);
  const a = computeExceptionRows(seed, new Set(), "");
  const b = computeExceptionRows(seed, new Set(), "");
  assert.deepEqual(a, b);
});
