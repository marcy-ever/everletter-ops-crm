/**
 * Canonical spec for the override-status keys app.js generates client-side
 * (mailingKey/componentKey/exceptionReviewKey in app/crm/legacy-app.js).
 * app.js is a real ES module now (the app.js -> ESM move, see CLAUDE.md)
 * but doesn't import this module - its own inline copies of these
 * functions remain the actual source of truth for what the browser sends.
 * This module exists so server-side write-to-tables code has a tested,
 * parseable spec to match incoming override keys against, instead of
 * re-deriving the format ad hoc. tests/keys.test.mjs verifies this module's
 * output is identical to app.js's real functions for the same input.
 *
 * Key shapes (see app/crm/legacy-app.js):
 *   mailingKey    = `${mailingId}::${sourceRow}`
 *   componentKey  = `${mailingId}::${sourceRow}::${field}`
 *   exceptionReviewKey = `${mailingId}::${subscriberId}::${reason}::${shipDate}`
 *     (with 'unknown-mailing' / 'unknown-subscriber' / 'unknown-reason' /
 *     'no-ship-date' fallbacks for missing fields - see exceptionReviewKey below)
 *
 * mailingId is already the normalized mailings.id primary key (see
 * db/schema/mailings.ts) - sourceRow only exists in the key to guarantee
 * uniqueness client-side and isn't stored anywhere server-side, so parsing a
 * key only needs to recover mailingId (and, for component keys, the field).
 */

export interface MailingLike {
  mailingId: string;
  sourceRow: string | number;
}

export interface ExceptionLike {
  mailingId?: string | null;
  subscriberId?: string | null;
  reason?: string | null;
  shipDate?: string | null;
}

export function mailingKey(mailing: MailingLike): string {
  return `${mailing.mailingId}::${mailing.sourceRow}`;
}

export function componentKey(mailing: MailingLike, field: string): string {
  return `${mailingKey(mailing)}::${field}`;
}

export function exceptionReviewKey(item: ExceptionLike): string {
  return [
    item.mailingId || "unknown-mailing",
    item.subscriberId || "unknown-subscriber",
    item.reason || "unknown-reason",
    item.shipDate || "no-ship-date",
  ].join("::");
}

export interface ParsedMailingKey {
  mailingId: string;
  sourceRow: string;
}

/**
 * Parses a mailingKey (mailingStatus override key) back into its parts.
 * Returns null for anything that doesn't have exactly the 2 segments a real
 * mailingKey always has - this module never guesses at a malformed key.
 */
export function parseMailingKey(key: string): ParsedMailingKey | null {
  if (typeof key !== "string") return null;
  const parts = key.split("::");
  if (parts.length !== 2) return null;
  const [mailingId, sourceRow] = parts;
  if (!mailingId || !sourceRow) return null;
  return { mailingId, sourceRow };
}

export interface ParsedComponentKey {
  mailingId: string;
  sourceRow: string;
  field: string;
}

/**
 * Parses a componentKey (componentStatus override key) back into its parts.
 * Returns null for anything that doesn't have exactly the 3 segments a real
 * componentKey always has.
 */
export function parseComponentKey(key: string): ParsedComponentKey | null {
  if (typeof key !== "string") return null;
  const parts = key.split("::");
  if (parts.length !== 3) return null;
  const [mailingId, sourceRow, field] = parts;
  if (!mailingId || !sourceRow || !field) return null;
  return { mailingId, sourceRow, field };
}

export interface ParsedExceptionReviewKey {
  mailingId: string;
  subscriberId: string;
  reason: string;
  shipDate: string;
}

/**
 * Parses an exceptionReviewKey (reviewedException override key) back into
 * its parts. Returns null for anything that doesn't have exactly the 4
 * segments a real exceptionReviewKey always has.
 *
 * Known structural limitation (see docs/schema-design.md): the normalized
 * exceptions table only stores mailing_id/subscription_id/type - it has no
 * column for subscriberId, reason, or shipDate. So subscriberId/reason/
 * shipDate can be parsed out of the key here, but the server-side matcher
 * cannot cross-check them against stored columns; it matches on mailing_id
 * alone. That's a schema limit, not something a smarter parser here could
 * fix.
 */
export function parseExceptionReviewKey(key: string): ParsedExceptionReviewKey | null {
  if (typeof key !== "string") return null;
  const parts = key.split("::");
  if (parts.length !== 4) return null;
  const [mailingId, subscriberId, reason, shipDate] = parts;
  if (!mailingId || !subscriberId || !reason || !shipDate) return null;
  return { mailingId, subscriberId, reason, shipDate };
}
