/**
 * The stable identity a mailing gets when it's actually written -
 * `${orderId}::${character}::${letterNumber}` - and the pure grouping that
 * decides when two or more source rows collide on it. The single
 * implementation, imported both client-side
 * (lib/domain/spreadsheet/build-seed.ts, to flag colliding rows as a Needs
 * Review exception) and server-side (lib/write-to-tables.ts, to decide
 * which colliding mailing actually gets written - db/schema/mailings.ts's
 * own comment explains why this shape, not app.js's own generated
 * mailingId, is the real primary key: app.js's mailingId collides for this
 * exact scenario, which is why a mailing-level collision check has to
 * exist here at all).
 *
 * Two independent implementations of "what counts as a duplicate" would
 * drift, and the failure is nasty in both directions - flagging a row that
 * imports fine, or staying silent on one that vanishes - so both sides
 * call the exact same functions here, the same treatment ids.ts/keys.ts/
 * mailing-rules.ts already got.
 */

export interface MailingCollisionInput {
  orderId: string;
  character: string;
  letterNumber?: string | number | null;
}

// `Number("")` is `0`, not `NaN` - this check has to come before the
// `Number()` call below, or every mailing with no letter number at all
// would collapse onto stableMailingId's own `""` fallback AND a real
// letter-number-zero mailing's `0`, merging two genuinely different "no
// letter number" and "letter number zero" cases into one collision group
// that shouldn't exist. Exported (not just used internally) because
// lib/write-to-tables.ts also needs this exact normalization for the
// mailings.letter_number column value itself, not just the collision key -
// same normalization, one definition, so the value it stores and the
// collision it's grouped by can never quietly disagree.
export function normalizeLetterNumber(value: string | number | null | undefined): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// mailings.id / the collision key: `${orderId}::${character}::${letterNumber}`
// (letterNumber empty-string if absent) - real, stable business fields, not
// app.js's own generated mailingId. No synthetic tie-breaker for a missing
// letterNumber: if two mailings under the same order+character both lack
// one, that's genuine, irreducible ambiguity in the source data, not
// something to guess through - see findMailingCollisions below for what
// happens to it.
export function stableMailingId(input: MailingCollisionInput): string {
  return `${input.orderId}::${input.character}::${normalizeLetterNumber(input.letterNumber) ?? ""}`;
}

export interface MailingCollisionGroup<T> {
  stableId: string;
  mailings: T[];
}

// Groups `mailings` by stableMailingId and returns only the groups with
// more than one member - the actual, shared definition of "these rows
// collide." Generic over T (a full seed/dataset mailing on either side,
// whichever shape that side's own array holds) so this stays usable from
// both a client-built Dataset's DatasetMailing[] and a server-side Seed's
// SeedMailing[] without either side reshaping its data to fit this
// function first - both shapes already carry orderId/character/
// letterNumber directly.
export function findMailingCollisions<T extends MailingCollisionInput>(mailings: T[]): MailingCollisionGroup<T>[] {
  const byStableId = new Map<string, T[]>();
  for (const mailing of mailings) {
    const stableId = stableMailingId(mailing);
    if (!byStableId.has(stableId)) byStableId.set(stableId, []);
    byStableId.get(stableId)!.push(mailing);
  }
  const groups: MailingCollisionGroup<T>[] = [];
  for (const [stableId, group] of byStableId) {
    if (group.length > 1) groups.push({ stableId, mailings: group });
  }
  return groups;
}
