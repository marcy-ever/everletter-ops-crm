import assert from "node:assert/strict";
import test from "node:test";
import { buildComponentOverrides, buildReviewedExceptionKeys } from "../lib/build-overrides-from-tables.ts";
import { componentKey, exceptionReviewKey } from "../lib/domain/keys.ts";

test("buildComponentOverrides: keys each row using the real componentKey() format (mailingId::sourceRow::field)", () => {
  const rows = [
    { componentType: "envelope", status: "Printed", mailingAppId: "MAIL-ABC1", mailingSourceRow: "5" },
    { componentType: "qa", status: "Ready", mailingAppId: "MAIL-ABC1", mailingSourceRow: "5" },
    { componentType: "letter", status: "Stuffed", mailingAppId: "MAIL-XYZ2", mailingSourceRow: "12" },
  ];
  const result = buildComponentOverrides(rows);
  assert.deepEqual(result, {
    [componentKey({ mailingId: "MAIL-ABC1", sourceRow: "5" }, "envelope")]: "Printed",
    [componentKey({ mailingId: "MAIL-ABC1", sourceRow: "5" }, "qa")]: "Ready",
    [componentKey({ mailingId: "MAIL-XYZ2", sourceRow: "12" }, "letter")]: "Stuffed",
  });
});

test("buildComponentOverrides: skips a row with no resolvable mailing instead of producing a bogus key", () => {
  const rows = [
    { componentType: "envelope", status: "Printed", mailingAppId: null, mailingSourceRow: null },
    { componentType: "qa", status: "Ready", mailingAppId: "MAIL-ABC1", mailingSourceRow: null },
  ];
  const result = buildComponentOverrides(rows);
  assert.deepEqual(result, {});
});

test("buildReviewedExceptionKeys: produces the real exceptionReviewKey() format when mailingId/shipDate/subscriberId are all present", () => {
  const rows = [
    { reason: "Missing ship date", subscriberId: "SUB-1", mailingAppId: "MAIL-ABC1", shipDate: "2026-08-01" },
    { reason: "Missing email", subscriberId: "SUB-2", mailingAppId: "MAIL-XYZ2", shipDate: "2026-08-15" },
  ];
  const result = buildReviewedExceptionKeys(rows);
  assert.deepEqual(result, [
    exceptionReviewKey({ mailingId: "MAIL-ABC1", subscriberId: "SUB-1", reason: "Missing ship date", shipDate: "2026-08-01" }),
    exceptionReviewKey({ mailingId: "MAIL-XYZ2", subscriberId: "SUB-2", reason: "Missing email", shipDate: "2026-08-15" }),
  ]);
});

test("buildReviewedExceptionKeys: skips a row missing any of mailingId/shipDate/subscriberId instead of computing a placeholder-based key that wouldn't match app.js's real key", () => {
  const rows = [
    { reason: "Missing ship date", subscriberId: "SUB-1", mailingAppId: null, shipDate: null }, // subscription-only fallback case
    { reason: "Missing email", subscriberId: null, mailingAppId: "MAIL-ABC1", shipDate: "2026-08-01" },
    { reason: "Missing address", subscriberId: "SUB-3", mailingAppId: "MAIL-ABC2", shipDate: null },
  ];
  const result = buildReviewedExceptionKeys(rows);
  assert.deepEqual(result, []);
});

test("buildReviewedExceptionKeys: mixed resolvable/unresolvable rows only emit the resolvable ones", () => {
  const rows = [
    { reason: "Missing ship date", subscriberId: "SUB-1", mailingAppId: null, shipDate: null },
    { reason: "Missing email", subscriberId: "SUB-2", mailingAppId: "MAIL-XYZ2", shipDate: "2026-08-15" },
  ];
  const result = buildReviewedExceptionKeys(rows);
  assert.deepEqual(result, [exceptionReviewKey({ mailingId: "MAIL-XYZ2", subscriberId: "SUB-2", reason: "Missing email", shipDate: "2026-08-15" })]);
});
