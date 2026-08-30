/**
 * Flags a normalized spreadsheet row as broken/needs-review data: missing
 * required fields, a ship date that isn't a real 1st/15th batch date, or a
 * mailing already marked Mailed with a ship date still in the future.
 * These are exactly the exception reasons buildSeedFromSpreadsheet
 * (lib/domain/spreadsheet/build-seed.ts) turns into `exceptions` array
 * entries for Active rows. Pure - the reference "today" is a real
 * parameter, not read from `new Date()` - so it ships in both the client
 * bundle (app/crm/legacy-app.js) and server code.
 */

export interface ExceptionCheckRow {
  recipientName: string;
  address: string;
  email: string;
  character: string;
  plan: string;
  shipDate: string;
  status: string;
}

// `today` (a "YYYY-MM-DD" string, e.g. from lib/domain/mailing-rules.ts's
// todayIso()) is threaded in explicitly by the caller rather than read from
// the clock here - same reasoning as todayIso(now) itself (step 3a) and
// buildSeedFromSpreadsheet(rows, sourceName, now, ...) (this same step):
// a function that reads "now" internally can't be tested without patching
// the global Date.
export function spreadsheetExceptionReasons(row: ExceptionCheckRow, activeState: string, today: string): string[] {
  const reasons: string[] = [];
  if (!row.recipientName || row.recipientName === "Unknown recipient") reasons.push("Missing recipient");
  if (!row.address) reasons.push("Missing address");
  if (!row.email) reasons.push("Missing email");
  if (!row.character || row.character === "Needs Review") reasons.push("Missing character");
  if (!row.plan || row.plan === "Needs Review") reasons.push("Missing subscription");
  if (!row.shipDate) reasons.push("Missing ship date");
  if (row.shipDate) {
    const day = Number(row.shipDate.slice(-2));
    if (![1, 15].includes(day)) reasons.push("Ship date is not a 1st/15th batch");
  }
  if (activeState === "Active" && row.status === "Mailed" && row.shipDate && row.shipDate > today) {
    reasons.push("Future mailing already marked mailed");
  }
  return reasons;
}

/**
 * Duplicate-mailing detection: the cross-row half of exception detection,
 * deliberately separate from spreadsheetExceptionReasons above rather than
 * a parameter added to it. That function sees one row at a time by design
 * (every one of its checks is a property of that row alone); whether a row
 * collides with another on order+character+letter number is a property of
 * the *set* of rows, which a per-row function structurally can't see
 * without being handed the whole dataset - exactly what this task's own
 * design requirement says not to do to it. This runs as a separate pass,
 * after the per-row one, and its results get merged into the same
 * `exceptions` array by buildSeedFromSpreadsheet (lib/domain/spreadsheet/
 * build-seed.ts) - not inserted as a second exceptions row per mailing,
 * since the normalized `exceptions` table only ever holds one row per
 * mailing_id (lib/write-to-tables.ts).
 *
 * Uses lib/domain/mailing-collision.ts's findMailingCollisions() - the
 * exact same collision definition lib/write-to-tables.ts's writeImport()
 * uses to decide which colliding mailing actually gets written. One
 * shared definition of "these rows collide," not two that could drift.
 */

import { findMailingCollisions, type MailingCollisionInput } from "../mailing-collision";

// Severity for the duplicate-mailing reason below - stated explicitly
// rather than left to fall out of word choice the way the case-sensitive
// substring classifier above/in build-seed.ts works for every OTHER
// reason (see that classifier's own comment on the trap - a reason
// containing "Missing" or "ship date" gets High "by accident" there).
// This reason never goes through that classifier at all: it's produced
// here, not by spreadsheetExceptionReasons, specifically so its severity
// has to be a real decision, not a side effect of what words happen to be
// in the sentence.
//
// Decision: High. Nobody knows which of the colliding rows is the real
// one, so none should be mailed until the spreadsheet is fixed - silently
// mailing one of several ambiguous rows is worse than holding all of
// them. The real cost: the one row that might actually be legitimate now
// gets held too, not just the ones that are wrong. That's a product
// call about how Marcy and Ashley work, not an engineering one - flagged
// as such and made reversibly: this is the one constant to flip if Brad
// decides otherwise, nothing else here depends on which way it goes.
// Pinned by tests/spreadsheet-exceptions.test.mjs.
export const DUPLICATE_MAILING_SEVERITY: "High" | "Low" = "High";

// Explicit severity for reasons authored outside spreadsheetExceptionReasons'
// own per-row set, checked by BOTH the client seed builder
// (lib/domain/spreadsheet/build-seed.ts) and the server-side dataset
// reconstruction (lib/build-dataset-from-tables.ts's buildExceptions(),
// which has its own independent copy of the same case-sensitive substring
// classifier and would otherwise reclassify a reason this module produces
// severity by accident too, the moment a real import is reloaded from the
// database rather than freshly published) - both call this FIRST, before
// falling back to their own unchanged substring classifier. A lookup by
// reason PREFIX, not the full reason text: duplicateMailingFlags() below
// embeds the specific colliding row numbers in its own reason text, which
// differs per row, so an exact-string table can't key on it. Deliberately
// small and additive - this is the "contained way" of declaring severity
// for a new reason, not a rewrite of the existing classifier, which stays
// completely untouched (and every reason it already classifies keeps the
// exact same severity it always had).
const EXPLICIT_SEVERITY_BY_PREFIX: Array<{ prefix: string; severity: "High" | "Low" }> = [
  { prefix: "Duplicate:", severity: DUPLICATE_MAILING_SEVERITY },
  { prefix: "Possible duplicate customer:", severity: "High" },
  { prefix: "Overlapping subscriptions:", severity: "High" },
  { prefix: "Duplicate letter number:", severity: "High" },
  { prefix: "Letter sequence out of sync:", severity: "High" },
  { prefix: "Ship date is not a 1st/15th batch", severity: "High" },
  { prefix: "Future mailing already marked mailed", severity: "High" },
];

export function explicitExceptionSeverity(reason: string): "High" | "Low" | null {
  const match = EXPLICIT_SEVERITY_BY_PREFIX.find((entry) => reason.startsWith(entry.prefix));
  return match ? match.severity : null;
}

export interface DuplicateCheckMailing extends MailingCollisionInput {
  mailingId: string;
  sourceRow: number;
}

export interface DuplicateMailingFlag<T> {
  mailing: T;
  reason: string;
}

// One flag per mailing that collides with at least one other - not one per
// collision group - so a group of three colliding rows produces three
// flags, each naming the *other* two, not one flag naming all three
// (including itself). That's what lets someone open the spreadsheet at any
// one of the affected rows and immediately see which others to check too,
// per this task's own requirement.
export function duplicateMailingFlags<T extends DuplicateCheckMailing>(mailings: T[]): DuplicateMailingFlag<T>[] {
  const flags: DuplicateMailingFlag<T>[] = [];
  for (const group of findMailingCollisions(mailings)) {
    for (const mailing of group.mailings) {
      const otherRows = group.mailings
        .filter((other) => other !== mailing)
        .map((other) => other.sourceRow)
        .sort((a, b) => a - b);
      const rowWord = otherRows.length > 1 ? "rows" : "row";
      flags.push({
        mailing,
        reason: `Duplicate: shares order, character, and letter number with ${rowWord} ${otherRows.join(", ")}`,
      });
    }
  }
  return flags;
}
