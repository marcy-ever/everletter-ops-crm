/**
 * Everything that decides whether a POST /api/shared-state payload is
 * safe to write, before app/api/shared-state/route.ts opens the
 * transaction that actually writes it. This is the single choke point
 * `writeImport()` (lib/write-to-tables.ts) sits behind: that function
 * deletes every subscriber/subscription/order/mailing/exception not
 * present in the incoming payload, so a truncated upload or a
 * malformed-but-parseable body reaching it unchecked silently destroys
 * real records. See this module's own PR for the full data-integrity
 * gap this closes.
 *
 * Three independent checks live here, each throwing a distinct, typed
 * error the route handler maps to the right HTTP status:
 *  - Payload size, checked before the body is even parsed
 *    (PayloadTooLargeError -> 413).
 *  - Payload *shape* - key parses, value is a recognized status, a
 *    crmDataset carries the fields lib/domain/dataset.ts's Dataset type
 *    expects (SharedStateValidationError -> 400). Structural only:
 *    nothing here validates business rules - a real import legitimately
 *    contains rows the app itself flags as broken (see
 *    lib/write-to-tables.ts's own module comment), and rejecting those
 *    would break the Needs Review workflow entirely.
 *  - Catastrophic deletion: before any write happens, compares what a
 *    crmDataset import would keep against what's currently in the
 *    mailings table, and refuses if it would remove more than a
 *    threshold share (CatastrophicDeletionError -> 409) unless the
 *    caller explicitly overrides it.
 *
 * Deliberately hand-written, not a validation library (zod/yup/etc.):
 * every shape checked here is small (a handful of fields, most already
 * typed in lib/domain/dataset.ts and lib/domain/keys.ts), and the
 * existing key parsers already do the hard part - reusing them is less
 * code and less risk than describing the same shapes twice in a new
 * schema language.
 */

import type { Dataset } from "./domain/dataset";
import { MAILING_STATUSES } from "./domain/mailing-rules";
import { COMPONENT_FIELD_OPTIONS } from "./domain/component-fields";
import { parseComponentKey, parseExceptionReviewKey, parseMailingKey } from "./domain/keys";
import { mailings } from "@/db/schema/mailings";
import type { Db, Seed } from "./write-to-tables";
import { estimateKeptMailingIds } from "./write-to-tables";

export class SharedStateValidationError extends Error {}
export class PayloadTooLargeError extends Error {}
export class CatastrophicDeletionError extends Error {}

// Measured directly against the real 1,218-row test fixture
// (testing/Import_20260812_181828.xlsx) as of 2026-08-15: the full POST
// body app.js's saveSharedDataset() actually sends - {kind: "crmDataset",
// key: "current", value: <the seed+metadata JSON, itself stringified>} -
// is 902,109 bytes (~881 KB). 10 MiB gives ~11.6x headroom over that real
// size: room for years of subscriber-base growth before a legitimate
// import could ever approach it, while still catching a genuinely
// oversized or corrupted body. If this constant is ever hit by a real
// import, that's a strong signal the dataset has grown enough to need a
// deliberate look, not proof of a bug - re-measure before just raising
// the number.
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

export function assertPayloadSize(byteLength: number): void {
  if (byteLength > MAX_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError(`Request body is ${byteLength} bytes, exceeding the ${MAX_PAYLOAD_BYTES}-byte (10 MiB) limit.`);
  }
}

export function validateMailingStatusPayload(key: string, value: string): void {
  const parsed = parseMailingKey(key);
  if (!parsed) {
    throw new SharedStateValidationError(`mailingStatus key "${key}" is not a valid mailingKey (expected "mailingId::sourceRow").`);
  }
  if (!MAILING_STATUSES.includes(value)) {
    throw new SharedStateValidationError(`"${value}" is not a valid mailing status. Expected one of: ${MAILING_STATUSES.join(", ")}.`);
  }
}

export function validateSubscriberStatusPayload(key: string, value: string): void {
  if (!key.trim()) throw new SharedStateValidationError("Subscriber ID is required.");
  if (!["Active", "Inactive"].includes(value)) {
    throw new SharedStateValidationError('Subscriber status must be "Active" or "Inactive".');
  }
}

export function validateSubscriberEmailPayload(key: string, value: string): void {
  if (!key.trim()) throw new SharedStateValidationError("Subscriber ID is required.");
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new SharedStateValidationError("Enter a valid customer email address.");
  }
}

export function validateMailingLetterNumberPayload(key: string, value: string): void {
  if (!parseMailingKey(key)) throw new SharedStateValidationError(`mailingLetterNumber key "${key}" is not a valid mailingKey.`);
  const letterNumber = Number(value);
  if (!Number.isInteger(letterNumber) || letterNumber < 1 || letterNumber > 999) {
    throw new SharedStateValidationError("Letter number must be a whole number from 1 to 999.");
  }
}

export function validateMailingShipDatePayload(key: string, value: string): void {
  if (!parseMailingKey(key)) throw new SharedStateValidationError(`mailingShipDate key "${key}" is not a valid mailingKey.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) {
    throw new SharedStateValidationError("Enter a valid ship date.");
  }
}

export function validateComponentStatusPayload(key: string, value: string): void {
  const parsed = parseComponentKey(key);
  if (!parsed) {
    throw new SharedStateValidationError(`componentStatus key "${key}" is not a valid componentKey (expected "mailingId::sourceRow::field").`);
  }
  if (parsed.field === "needsDone") {
    if (value.length > 500) {
      throw new SharedStateValidationError('"needsDone" notes must be 500 characters or fewer.');
    }
    return;
  }
  const validOptions = COMPONENT_FIELD_OPTIONS[parsed.field];
  if (!validOptions) {
    throw new SharedStateValidationError(`"${parsed.field}" is not a known component field. Expected one of: ${Object.keys(COMPONENT_FIELD_OPTIONS).join(", ")}.`);
  }
  if (!validOptions.includes(value)) {
    throw new SharedStateValidationError(`"${value}" is not a valid status for the "${parsed.field}" component. Expected one of: ${validOptions.join(", ")}.`);
  }
}

export function validateReviewedExceptionPayload(key: string): void {
  const parsed = parseExceptionReviewKey(key);
  if (!parsed) {
    throw new SharedStateValidationError(`reviewedException key "${key}" is not a valid exceptionReviewKey (expected "mailingId::subscriberId::reason::shipDate").`);
  }
}

// The 7 array fields Dataset (lib/domain/dataset.ts) carries alongside
// `summary`. Written out explicitly (the type itself disappears at
// runtime, so there's nothing to derive this from at build time) -
// `satisfies` catches a typo or a field that's been renamed/removed from
// Dataset, but not a *new* field added to Dataset without a matching
// addition here; tests/validate-shared-state.test.mjs asserts this array
// has exactly Dataset's 7 non-summary keys as a real, current check, not
// just a compile-time one.
const DATASET_ARRAY_FIELDS = ["subscribers", "recipients", "orders", "subscriptions", "mailings", "exceptions", "automationRules"] satisfies readonly Exclude<
  keyof Dataset,
  "summary"
>[];

export interface ParsedCrmDatasetPayload {
  seed: Dataset;
  sourceName: string;
  raw: Record<string, unknown>;
}

// Parses and structurally validates a crmDataset POST's `value` field
// (a JSON string). Only checks shape - see this module's header for why
// business-rule validation deliberately doesn't belong here.
export function parseAndValidateCrmDatasetValue(value: string): ParsedCrmDatasetPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SharedStateValidationError("crmDataset value is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SharedStateValidationError("crmDataset value must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  if (!("seed" in record) || typeof record.seed !== "object" || record.seed === null || Array.isArray(record.seed)) {
    throw new SharedStateValidationError("crmDataset value is missing a seed object.");
  }
  const seed = record.seed as Record<string, unknown>;
  for (const field of DATASET_ARRAY_FIELDS) {
    if (!Array.isArray(seed[field])) {
      throw new SharedStateValidationError(`crmDataset.seed.${field} must be an array.`);
    }
    if ((seed[field] as unknown[]).some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
      throw new SharedStateValidationError(`crmDataset.seed.${field} must contain only objects.`);
    }
  }
  if (typeof seed.summary !== "object" || seed.summary === null || Array.isArray(seed.summary)) {
    throw new SharedStateValidationError("crmDataset.seed.summary must be an object.");
  }

  const sourceName = typeof record.sourceName === "string" && record.sourceName ? record.sourceName : "unknown";
  return { seed: seed as unknown as Dataset, sourceName, raw: record };
}

// The share of *currently existing* mailings an import is allowed to
// remove before it's refused outright. Chosen by looking at the real
// fixture (testing/Import_20260812_181828.xlsx, 1,218 mailings): 710
// (58%) are already status "Mailed" - a rolling schedule that keeps a
// long operational history rather than pruning completed rows, so
// legitimate reimport-to-reimport churn (subscriptions actually ending)
// should stay well under half the dataset. Even a deliberately extreme
// scenario - every Month-to-month (339) and One-time (66) mailing ending
// at once, the two plan types with the shortest/least-committed terms -
// is only 405 of 1,218 (33%). A truncated or half-written upload, by
// contrast, loses the vast majority of rows outright. 60% sits above any
// plausible legitimate-churn scenario in this data and below a truncated
// file's near-total loss, with real margin on both sides.
export const CATASTROPHIC_DELETION_THRESHOLD = 0.6;

// Reads the mailings table and compares it against what this import
// would keep (see estimateKeptMailingIds's own header for what "would
// keep" means here) - a pure read, called before runImport() writes
// anything. Pass override: true (POST body's "confirmLargeDelete" field -
// deliberately not wired into any UI, see this module's PR) to skip the
// check for a genuinely intended large deletion.
export async function assertNotCatastrophicDeletion(seed: Seed, db: Db, override: boolean): Promise<void> {
  if (override) return;
  const existingRows = await db.select({ id: mailings.id }).from(mailings);
  const existingCount = existingRows.length;
  if (existingCount === 0) return;
  const keepIds = estimateKeptMailingIds(seed);
  const wouldDeleteCount = existingRows.filter((row) => !keepIds.has(row.id)).length;
  const ratio = wouldDeleteCount / existingCount;
  if (ratio > CATASTROPHIC_DELETION_THRESHOLD) {
    const percent = Math.round(ratio * 100);
    throw new CatastrophicDeletionError(
      `This import contains ${seed.mailings.length} mailings and would remove ${wouldDeleteCount} of ${existingCount} existing ones (${percent}%), over the ${Math.round(CATASTROPHIC_DELETION_THRESHOLD * 100)}% threshold - refused. Pass "confirmLargeDelete": true in the POST body to force it.`,
    );
  }
}
