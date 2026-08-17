import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { subscribers } from "@/db/schema/subscribers";
import { subscriptions } from "@/db/schema/subscriptions";
import { orders } from "@/db/schema/orders";
import { mailings } from "@/db/schema/mailings";
import { mailingComponents } from "@/db/schema/mailing_components";
import { exceptions } from "@/db/schema/exceptions";
import { mailingKey as appMailingKey, parseComponentKey, parseExceptionReviewKey, parseMailingKey } from "@/lib/domain/keys";
import { buildRecipientId, buildSubscriptionId } from "@/lib/domain/ids";

/**
 * Writes app.js's crmDataset/mailingStatus/componentStatus/
 * reviewedException payloads into the normalized tables (see db/schema/,
 * docs/schema-design.md) - the only write app/api/shared-state/route.ts's
 * POST handler does.
 *
 * Every exported function here takes the caller's db/transaction handle
 * (see the `Db` type below) rather than opening its own connection, and
 * none of them swallow an unexpected error: a real failure (a bad
 * connection, a constraint violation, a bug) propagates up and rolls back
 * the whole transaction via app/api/shared-state/route.ts's
 * `db.transaction()`. This is deliberately different from the per-record
 * skip-and-log calls throughout this file (e.g. "skipping subscription,
 * unrecognized plan") - those are expected, legitimate business outcomes
 * (app.js's own exceptions mechanism already flags the same rows as
 * broken), not errors, and still don't throw. Only genuinely unexpected
 * failures propagate.
 *
 * Known, deliberate simplifications (see docs/schema-design.md for the
 * full reasoning behind each):
 *  - address is stored as one opaque blob in address_line1; line2/city/
 *    state/zip are never populated (app.js never produces structured
 *    address fields to begin with).
 *  - subscriptions/mailings rows are skipped (not written) when the
 *    source data is already something app.js itself treats as broken (an
 *    unrecognized plan, or a missing ship date) - guessing a value or
 *    throwing would both be worse than skipping a row app.js's own
 *    exceptions mechanism already flags as broken.
 *  - exceptions.type stores app.js's raw joined `reason` string, not a
 *    normalized bad_address/missing_date/duplicate/unusual_sequence
 *    category - app.js's actual reason strings don't correspond to any
 *    small fixed set of categories, so forcing one here would just be a
 *    different kind of guess.
 *  - reviewedException override keys are matched to an exceptions row via
 *    mailings.app_mailing_id (joined through exceptions.mailing_id),
 *    exceptions.type == the key's reason segment, and (as of the
 *    review_key_subscriber_id/review_key_ship_date columns - see
 *    db/schema/exceptions.ts) the key's subscriberId/shipDate segments too -
 *    all four segments of exceptionReviewKey (lib/domain/keys.ts) are now
 *    cross-checked, closing what used to be a real, documented gap (two
 *    exceptions sharing a mailing and a reason string were previously
 *    indistinguishable).
 *  - mailings.id is NOT app.js's own generated mailingId - see the column
 *    comment in db/schema/mailings.ts for why (it collides routinely for
 *    the most common subscription pattern) and what's used instead.
 *
 * Every write* function below returns a WriteOutcome (previousValue/
 * newValue) on an actual write, or null when it soft-skipped (unparseable
 * key, no matching row, etc.) - app/api/shared-state/route.ts uses this to
 * decide whether to write an audit_events row, so a skip-and-log case
 * (nothing changed) never produces one. Returning the outcome rather than
 * writing the audit row here keeps this file focused on writing the
 * normalized tables; the route is the single audit choke point (it already
 * resolves the actor via auth()) and both halves stay independently
 * testable. previousValue is read via a SELECT immediately before each
 * UPDATE/INSERT, inside the same transaction the caller is already in - no
 * new race introduced beyond what every other read-then-write in this file
 * already does.
 */

// The db handle every exported function here takes - either the real
// getDb() result, or (in normal operation, via
// app/api/shared-state/route.ts) the `tx` inside a db.transaction()
// callback. Both have the same query-building surface (.select/.insert/
// .update/.delete) but aren't structurally identical types (a transaction
// lacks getDb()'s $client), so this is a real union, not just one of them -
// this file never opens its own connection or transaction, it just uses
// whichever one the caller is already inside.
type RealDb = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<RealDb["transaction"]>[0]>[0];
export type Db = RealDb | Tx;

interface SeedRecipient {
  recipientId: string;
  subscriberId: string;
  name: string;
  address: string;
}

interface SeedSubscriber {
  subscriberId: string;
  email: string;
  displayName: string;
  status: string;
}

interface SeedOrder {
  orderId: string;
  subscriberId: string;
  sourceOrderNumber: string;
  createdOn: string;
}

interface SeedSubscription {
  subscriptionId: string;
  subscriberId: string;
  recipientId: string;
  plan: string;
  character: string;
  startDate: string;
  endDate: string;
  activeState: string;
}

interface SeedMailing {
  mailingId: string;
  subscriptionId: string;
  recipientId: string;
  orderId: string;
  character: string;
  recipientName: string;
  letterNumber: string | number | null | undefined;
  shipDate: string;
  status: string;
  activeState: string;
  notes: string;
  sourceRow: number | string;
}

interface SeedException {
  exceptionId: string;
  reason: string;
  mailingId: string;
  subscriberId: string;
  shipDate: string;
  sourceRow: number | string;
}

export interface Seed {
  subscribers: SeedSubscriber[];
  recipients: SeedRecipient[];
  orders: SeedOrder[];
  subscriptions: SeedSubscription[];
  mailings: SeedMailing[];
  exceptions: SeedException[];
}

// What a write* function actually changed - see the module comment above
// for why this is returned rather than written to audit_events here.
// previousValue is null for a first-ever write to a key (an insert, not an
// update) - there's genuinely no prior to report, not an unknown one.
export interface WriteOutcome {
  previousValue: string | null;
  newValue: string;
}

// Matches lib/domain/plans.ts's own plannedLetterCount() for the three
// metered plans, plus One-time - which plannedLetterCount treats as its
// "anything else" fallback of 1. "Needs Review"/unrecognized plans are not
// in this table on purpose: they're not a real cadence to report a count
// for, so those subscriptions are skipped below rather than guessing.
const LETTERS_BY_PLAN: Record<string, number> = {
  "Month-to-month": 2,
  "6-month": 12,
  "12-month": 24,
  "One-time": 1,
};

function log(...args: unknown[]) {
  console.error("[write-to-tables]", ...args);
}

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeLetterNumber(value: string | number | null | undefined): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// mailings.id: `${orderId}::${character}::${letterNumber}` (letterNumber
// empty-string if absent) - real, stable business fields, not app.js's own
// mailingId (which collides - see db/schema/mailings.ts). No synthetic
// tie-breaker for a missing letterNumber: if two mailings under the same
// order+character both lack one, that's genuine, irreducible ambiguity in
// the source data (see the collision check in the mailings loop below),
// not something to guess through.
function stableMailingId(orderId: string, character: string, letterNumber: number | null): string {
  return `${orderId}::${character}::${letterNumber ?? ""}`;
}

// An approximation - permissive, not conservative, see the note below -
// of which mailings.id values this import would keep, used only by
// app/api/shared-state/route.ts's
// catastrophic-deletion guard (lib/validate-shared-state.ts) BEFORE
// runImport() runs - nothing has been written yet when this is called.
// Mirrors the two runImport() checks that matter most for a
// bulk-deletion estimate (subscription keepability, ship-date presence)
// but deliberately skips the rarer ambiguous-stable-id cross-check (two
// mailings landing on the same order+character+letterNumber, see
// runImport()'s own mailings loop) - that case is self-limiting (it
// discards only the colliding pair, never a large share of the dataset),
// so skipping it here only makes this estimate marginally more
// permissive in a rare edge case, never less safe for what this guard
// actually needs to catch: a truncated or corrupted upload. The real
// per-row skip/keep decisions during the actual write remain exactly
// runImport()'s own logic below, entirely untouched by this function.
// Direction of the error, spelled out: this over-counts "kept" (treating
// a colliding pair as both kept when runImport() would discard both),
// which under-counts deletions, which makes the catastrophic-deletion
// guard marginally more likely to let an import through than to block
// one wrongly - permissive, not conservative-toward-blocking. Fine given
// how self-limiting the skipped case is today; worth re-checking if a
// future change ever widens the gap between this and runImport()'s real
// logic.
export function estimateKeptMailingIds(seed: Seed): Set<string> {
  const recipientsById = new Map(seed.recipients.map((r) => [r.recipientId, r]));
  const keepSubscriptionIds = new Set<string>();
  for (const s of seed.subscriptions) {
    if (LETTERS_BY_PLAN[s.plan] === undefined) continue;
    if (!recipientsById.has(s.recipientId)) continue;
    keepSubscriptionIds.add(s.subscriptionId);
  }
  const keep = new Set<string>();
  for (const m of seed.mailings) {
    if (!m.shipDate) continue;
    if (!keepSubscriptionIds.has(m.subscriptionId)) continue;
    keep.add(stableMailingId(m.orderId, m.character, normalizeLetterNumber(m.letterNumber)));
  }
  return keep;
}

export async function writeImport(seed: Seed, db: Db): Promise<void> {
  await runImport(seed, db);
}

async function runImport(seed: Seed, db: Db) {
  const recipientsById = new Map(seed.recipients.map((r) => [r.recipientId, r]));

  // Defense in depth against the collision this module's
  // SeedRecipient/SeedSubscription ids depend on hashing to avoid (see
  // lib/ids.ts's module comment): recompute each recipientId/subscriptionId
  // from the same raw fields app.js used and log (never block) if app.js's
  // inline copy has drifted from lib/ids.ts's spec.
  for (const r of seed.recipients) {
    const expected = buildRecipientId({ subscriberId: r.subscriberId, recipientName: r.name, address: r.address });
    if (expected !== r.recipientId) {
      log("recipientId does not match lib/ids.ts's spec for its own name+address - app.js may have drifted:", r.recipientId, "expected:", expected);
    }
  }
  for (const s of seed.subscriptions) {
    const expected = buildSubscriptionId({ recipientId: s.recipientId, character: s.character, plan: s.plan });
    if (expected !== s.subscriptionId) {
      log("subscriptionId does not match lib/ids.ts's spec for its own recipientId+character+plan - app.js may have drifted:", s.subscriptionId, "expected:", expected);
    }
  }

  // --- subscribers (always writable) ---
  const keepSubscriberIds = new Set<string>();
  for (const s of seed.subscribers) {
    const email = s.email || "";
    const name = s.displayName || "Unknown recipient";
    await db
      .insert(subscribers)
      .values({ id: s.subscriberId, email, name })
      .onConflictDoUpdate({ target: subscribers.id, set: { email, name } });
    keepSubscriberIds.add(s.subscriberId);
  }

  // --- subscriptions (skip: plan not in LETTERS_BY_PLAN, or recipient unresolvable) ---
  const keepSubscriptionIds = new Set<string>();
  for (const s of seed.subscriptions) {
    const totalLettersExpected = LETTERS_BY_PLAN[s.plan];
    const recipient = recipientsById.get(s.recipientId);
    if (totalLettersExpected === undefined) {
      log("skipping subscription, unrecognized plan (already flagged by app.js's own exceptions):", s.subscriptionId, s.plan);
      continue;
    }
    if (!recipient) {
      log("skipping subscription, no matching recipient:", s.subscriptionId, s.recipientId);
      continue;
    }
    const values = {
      subscriberId: s.subscriberId,
      character: s.character,
      termType: s.plan,
      status: s.activeState,
      startedAt: toDateOrNull(s.startDate),
      endedAt: toDateOrNull(s.endDate),
      totalLettersExpected,
      recipientName: recipient.name || "Unknown recipient",
      addressLine1: recipient.address || null,
    };
    await db
      .insert(subscriptions)
      .values({ id: s.subscriptionId, ...values })
      .onConflictDoUpdate({ target: subscriptions.id, set: values });
    keepSubscriptionIds.add(s.subscriptionId);
  }

  // --- orders (subscriptionId isn't on app.js's order objects - derive it
  // from the first mailing row that produced this orderId, mirroring the
  // same first-occurrence-wins pattern app.js itself uses for every other
  // Map in buildSeedFromSpreadsheet) ---
  const orderIdToSubscriptionId = new Map<string, string>();
  for (const m of seed.mailings) {
    if (!orderIdToSubscriptionId.has(m.orderId)) {
      orderIdToSubscriptionId.set(m.orderId, m.subscriptionId);
    }
  }

  const keepOrderIds = new Set<string>();
  for (const o of seed.orders) {
    const subscriptionId = orderIdToSubscriptionId.get(o.orderId);
    if (!subscriptionId || !keepSubscriptionIds.has(subscriptionId)) {
      log("skipping order, no resolvable/kept subscription:", o.orderId);
      continue;
    }
    const values = {
      subscriptionId,
      externalOrderNumber: o.sourceOrderNumber || "",
      amount: null,
      orderedAt: toDateOrNull(o.createdOn),
    };
    await db
      .insert(orders)
      .values({ id: o.orderId, ...values })
      .onConflictDoUpdate({ target: orders.id, set: values });
    keepOrderIds.add(o.orderId);
  }

  // --- mailings ---
  // Skip: missing ship date (already flagged by app.js's own exceptions),
  // subscription not kept, or an ambiguous stable id (see stableMailingId -
  // two different mailings landing on the exact same order+character+
  // letterNumber is data app.js itself never disambiguates either).
  //
  // mailingByAppKey is keyed by app.js's own mailingKey (mailingId+sourceRow
  // - see lib/keys.ts), which IS unique within a single import (sourceRow
  // is a plain row index). It's used below purely to let the exceptions
  // loop look up "which specific seed mailing (and, if written, which
  // stable id) does this exception belong to" without the ambiguity that
  // indexing by app.js's bare mailingId alone would reintroduce. Seeded
  // from the FULL seed.mailings list (not just the ones that end up
  // written) so exceptions on a skipped mailing (e.g. missing ship date)
  // can still fall back to that mailing's subscription_id below.
  const mailingByAppKey = new Map<string, { m: SeedMailing; stableId: string; written: boolean }>();
  for (const m of seed.mailings) {
    mailingByAppKey.set(appMailingKey(m), {
      m,
      stableId: stableMailingId(m.orderId, m.character, normalizeLetterNumber(m.letterNumber)),
      written: false,
    });
  }

  const candidateMailings = seed.mailings
    .filter((m) => {
      if (!m.shipDate) {
        log("skipping mailing, missing ship date (already flagged by app.js's own exceptions):", m.mailingId);
        return false;
      }
      if (!keepSubscriptionIds.has(m.subscriptionId)) {
        log("skipping mailing, subscription not kept:", m.mailingId, m.subscriptionId);
        return false;
      }
      return true;
    })
    .map((m) => ({ m, stableId: stableMailingId(m.orderId, m.character, normalizeLetterNumber(m.letterNumber)) }));

  const stableIdCounts = new Map<string, number>();
  for (const { stableId } of candidateMailings) {
    stableIdCounts.set(stableId, (stableIdCounts.get(stableId) ?? 0) + 1);
  }

  const keepMailingIds = new Set<string>();

  for (const { m, stableId } of candidateMailings) {
    const appKey = appMailingKey(m);
    if ((stableIdCounts.get(stableId) ?? 0) > 1) {
      log("skipping mailing, ambiguous stable id shared with another mailing (same order+character+letterNumber, cannot disambiguate without guessing):", stableId, m.mailingId);
      continue;
    }
    const recipient = recipientsById.get(m.recipientId);
    const values = {
      subscriptionId: m.subscriptionId,
      appMailingId: m.mailingId,
      lastSourceRow: String(m.sourceRow),
      letterNumber: normalizeLetterNumber(m.letterNumber),
      scheduledDate: m.shipDate,
      status: m.status || "",
      active: m.activeState === "Active",
      notes: m.notes || null,
      recipientName: m.recipientName || recipient?.name || "Unknown recipient",
      addressLine1: recipient?.address || null,
    };
    await db
      .insert(mailings)
      .values({ id: stableId, ...values })
      .onConflictDoUpdate({ target: mailings.id, set: values });
    keepMailingIds.add(stableId);
    mailingByAppKey.set(appKey, { m, stableId, written: true });
  }

  // --- exceptions ---
  // Mailing-backed exceptions are matched/preserved by mailing_id across
  // imports (so a previously reviewed exception stays reviewed on
  // re-import). Exceptions whose mailing was skipped fall back to
  // subscription_id only, with no reviewed-state preservation - see the
  // module docstring and docs/schema-design.md.
  const keptMailingExceptionIds = new Set<string>();
  const subscriptionOnlyExceptions: Array<{ subscriptionId: string; type: string; reviewKeySubscriberId: string | null; reviewKeyShipDate: string | null }> = [];

  for (const e of seed.exceptions) {
    const entry = mailingByAppKey.get(appMailingKey(e));
    const candidateSubscriptionId = entry?.m.subscriptionId;
    const mailingResolvable = !!entry?.written;
    const stableMailingIdForException = mailingResolvable ? entry!.stableId : null;
    const subscriptionResolvable = !!candidateSubscriptionId && keepSubscriptionIds.has(candidateSubscriptionId);
    const type = e.reason || "";
    // Snapshots of exceptionReviewKey's other two segments (see
    // db/schema/exceptions.ts's column comment) - null, not "", for an
    // absent value, matching parseExceptionReviewKey's "unknown-subscriber"
    // / "no-ship-date" fallbacks being treated as null at match time
    // (writeReviewedException below).
    const reviewKeySubscriberId = e.subscriberId || null;
    const reviewKeyShipDate = e.shipDate || null;

    if (!mailingResolvable && !subscriptionResolvable) {
      log("skipping exception, neither mailing nor subscription resolved:", e.exceptionId);
      continue;
    }

    if (mailingResolvable) {
      const existing = await db
        .select({ id: exceptions.id })
        .from(exceptions)
        .where(eq(exceptions.mailingId, stableMailingIdForException!));
      const subscriptionId = subscriptionResolvable ? candidateSubscriptionId! : null;
      if (existing.length === 0) {
        await db.insert(exceptions).values({ mailingId: stableMailingIdForException, subscriptionId, type, reviewKeySubscriberId, reviewKeyShipDate });
      } else if (existing.length === 1) {
        await db.update(exceptions).set({ subscriptionId, type, reviewKeySubscriberId, reviewKeyShipDate }).where(eq(exceptions.id, existing[0].id));
      } else {
        log("skipping exception update, multiple existing rows for mailing_id (unexpected):", stableMailingIdForException);
      }
      keptMailingExceptionIds.add(stableMailingIdForException!);
    } else {
      subscriptionOnlyExceptions.push({ subscriptionId: candidateSubscriptionId!, type, reviewKeySubscriberId, reviewKeyShipDate });
    }
  }

  // Reconcile mailing-backed exceptions no longer flagged this import.
  if (keptMailingExceptionIds.size) {
    await db
      .delete(exceptions)
      .where(and(isNotNull(exceptions.mailingId), notInArray(exceptions.mailingId, [...keptMailingExceptionIds])));
  } else {
    await db.delete(exceptions).where(isNotNull(exceptions.mailingId));
  }

  // Subscription-only fallback exceptions: simple clear-and-reinsert each
  // import (no reviewed-state preservation for this degraded case).
  await db.delete(exceptions).where(isNull(exceptions.mailingId));
  if (subscriptionOnlyExceptions.length) {
    await db.insert(exceptions).values(subscriptionOnlyExceptions);
  }

  // --- reconcile removals, children before parents ---
  // mailing_components isn't written during import at all (it's populated
  // reactively by writeComponentStatus, see below) - but it still has
  // a NOT NULL FK to mailings.id, so any component rows belonging to a
  // mailing that's about to be removed must go first or the mailings
  // delete below fails with a FK violation.
  if (keepMailingIds.size) {
    await db.delete(mailingComponents).where(notInArray(mailingComponents.mailingId, [...keepMailingIds]));
  } else {
    await db.delete(mailingComponents);
  }
  if (keepMailingIds.size) {
    await db.delete(mailings).where(notInArray(mailings.id, [...keepMailingIds]));
  } else {
    await db.delete(mailings);
  }
  if (keepOrderIds.size) {
    await db.delete(orders).where(notInArray(orders.id, [...keepOrderIds]));
  } else {
    await db.delete(orders);
  }
  if (keepSubscriptionIds.size) {
    await db.delete(subscriptions).where(notInArray(subscriptions.id, [...keepSubscriptionIds]));
  } else {
    await db.delete(subscriptions);
  }
  if (keepSubscriberIds.size) {
    await db.delete(subscribers).where(notInArray(subscribers.id, [...keepSubscriberIds]));
  } else {
    await db.delete(subscribers);
  }
}

// Resolves an incoming override's app.js mailingId+sourceRow to the current
// stable mailings row. Requires exactly one match: within a single import,
// (appMailingId, lastSourceRow) is unique (sourceRow is a plain row index),
// but if the DB has been re-imported with different row positions since the
// browser last loaded its data, zero or multiple rows can match - that's a
// real "can't confidently match" case, not a bug, so it's skip-and-log like
// everywhere else.
async function findMailingByAppKey(mailingId: string, sourceRow: string, db: Db): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: mailings.id })
    .from(mailings)
    .where(and(eq(mailings.appMailingId, mailingId), eq(mailings.lastSourceRow, sourceRow)));
  if (rows.length !== 1) {
    log(`no confident match for appMailingId+lastSourceRow (found ${rows.length}), skipping:`, mailingId, sourceRow);
    return null;
  }
  return rows[0];
}

export async function writeMailingStatus(key: string, status: string, db: Db): Promise<WriteOutcome | null> {
  const parsed = parseMailingKey(key);
  if (!parsed) {
    log("mailingStatus: could not parse key, skipping:", key);
    return null;
  }
  const match = await findMailingByAppKey(parsed.mailingId, parsed.sourceRow, db);
  if (!match) return null;
  const existing = await db.select({ status: mailings.status }).from(mailings).where(eq(mailings.id, match.id));
  const previousValue = existing[0]?.status ?? null;
  await db.update(mailings).set({ status }).where(eq(mailings.id, match.id));
  return { previousValue, newValue: status };
}

export async function writeComponentStatus(key: string, status: string, db: Db): Promise<WriteOutcome | null> {
  const parsed = parseComponentKey(key);
  if (!parsed) {
    log("componentStatus: could not parse key, skipping:", key);
    return null;
  }
  const match = await findMailingByAppKey(parsed.mailingId, parsed.sourceRow, db);
  if (!match) return null;
  const existing = await db
    .select({ id: mailingComponents.id, status: mailingComponents.status })
    .from(mailingComponents)
    .where(and(eq(mailingComponents.mailingId, match.id), eq(mailingComponents.componentType, parsed.field)));
  if (existing.length === 0) {
    await db.insert(mailingComponents).values({ mailingId: match.id, componentType: parsed.field, status });
    return { previousValue: null, newValue: status };
  } else if (existing.length === 1) {
    const previousValue = existing[0].status;
    await db
      .update(mailingComponents)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(mailingComponents.id, existing[0].id));
    return { previousValue, newValue: status };
  } else {
    log("componentStatus: multiple existing rows for mailing+field (unexpected), skipping:", parsed);
    return null;
  }
}

export async function writeReviewedException(key: string, db: Db): Promise<WriteOutcome | null> {
  const parsed = parseExceptionReviewKey(key);
  if (!parsed) {
    log("reviewedException: could not parse key, skipping:", key);
    return null;
  }
  // exceptionReviewKey carries no sourceRow, so exceptions can't be
  // disambiguated the same way mailings are - matched instead by joining
  // through to mailings.appMailingId, exceptions.type (which this module
  // always writes as the exact reason string, so it doubles as a real
  // second signal here - see the module docstring), and now (via
  // review_key_subscriber_id/review_key_ship_date - db/schema/exceptions.ts)
  // the key's remaining two segments too - all four of exceptionReviewKey's
  // segments are cross-checked as of this change, closing what used to be a
  // documented gap. "unknown-subscriber"/"no-ship-date" (parseExceptionReviewKey's
  // fallbacks for an absent segment) are treated as null here, matching how
  // runImport() stores an absent value as null rather than that literal
  // string - IS NOT DISTINCT FROM handles the null-vs-null case a plain
  // eq() would miss. Subscription-only fallback exceptions (mailing_id
  // null) are never reachable this way; that's an accepted, documented
  // limitation, unchanged by this.
  const expectedSubscriberId = parsed.subscriberId === "unknown-subscriber" ? null : parsed.subscriberId;
  const expectedShipDate = parsed.shipDate === "no-ship-date" ? null : parsed.shipDate;
  const rows = await db
    .select({ id: exceptions.id, reviewed: exceptions.reviewed })
    .from(exceptions)
    .innerJoin(mailings, eq(exceptions.mailingId, mailings.id))
    .where(
      and(
        eq(mailings.appMailingId, parsed.mailingId),
        eq(exceptions.type, parsed.reason),
        sql`${exceptions.reviewKeySubscriberId} IS NOT DISTINCT FROM ${expectedSubscriberId}`,
        sql`${exceptions.reviewKeyShipDate} IS NOT DISTINCT FROM ${expectedShipDate}`,
      ),
    );
  if (rows.length !== 1) {
    log(`reviewedException: expected exactly one matching exception, found ${rows.length}, skipping:`, parsed);
    return null;
  }
  const previousValue = String(rows[0].reviewed);
  await db.update(exceptions).set({ reviewed: true, reviewedAt: sql`now()` }).where(eq(exceptions.id, rows[0].id));
  return { previousValue, newValue: "true" };
}
