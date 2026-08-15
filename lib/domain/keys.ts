/**
 * Generates and parses the override-status keys (mailingKey/componentKey/
 * exceptionReviewKey) that key mailingStatus/componentStatus/
 * reviewedException overrides. The single implementation, imported both
 * client-side (app/crm/legacy-app.js, which generates these keys) and
 * server-side (lib/write-to-tables.ts, which parses incoming keys to match
 * them against normalized rows - the generating side has no need for the
 * parse* functions below, so it only imports the generators).
 * tests/keys.test.mjs locks the exact key format for a fixed set of sample
 * inputs - a drifted format here would orphan real override rows already
 * keyed by the old format, so that test asserts literal values, not just
 * "looks reasonable."
 *
 * Key shapes:
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
 * The normalized exceptions table stores mailing_id/type directly, plus
 * (as of db/schema/exceptions.ts's review_key_subscriber_id/
 * review_key_ship_date columns) a snapshot of this key's remaining two
 * segments - so the server-side matcher (writeReviewedException,
 * lib/write-to-tables.ts) now cross-checks all four of mailingId/
 * subscriberId/reason/shipDate against stored columns, not mailingId/reason
 * alone. See docs/schema-design.md for why those two columns didn't exist
 * originally and what closed the gap.
 */
export function parseExceptionReviewKey(key: string): ParsedExceptionReviewKey | null {
  if (typeof key !== "string") return null;
  const parts = key.split("::");
  if (parts.length !== 4) return null;
  const [mailingId, subscriberId, reason, shipDate] = parts;
  if (!mailingId || !subscriberId || !reason || !shipDate) return null;
  return { mailingId, subscriberId, reason, shipDate };
}
