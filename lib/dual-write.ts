import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { subscribers } from "@/db/schema/subscribers";
import { subscriptions } from "@/db/schema/subscriptions";
import { orders } from "@/db/schema/orders";
import { mailings } from "@/db/schema/mailings";
import { mailingComponents } from "@/db/schema/mailing_components";
import { exceptions } from "@/db/schema/exceptions";
import { mailingKey as appMailingKey, parseComponentKey, parseExceptionReviewKey, parseMailingKey } from "@/lib/keys";
import { buildRecipientId, buildSubscriptionId } from "@/lib/ids";

/**
 * Writes app.js's crmDataset/mailingStatus/componentStatus/
 * reviewedException payloads into the normalized Option A tables (see
 * db/schema/, docs/schema-design.md). Originally a shadow write alongside
 * the real crm_state blob write in app/api/shared-state/route.ts - as of
 * Option B Phase 2's final step, crm_state (table and write) is gone
 * entirely, and this is the only write app/api/shared-state/route.ts's
 * POST does.
 *
 * Phase 2 of Option B: load-bearing and transactional, not shadow/
 * validation-only anymore (see docs/schema-design.md's dual-write notes
 * for the full Phase 1 -> Phase 2 history). Every exported function here
 * takes the caller's db/transaction handle (see the `Db` type below) and
 * no longer swallows its own errors - a real failure here (a bad
 * connection, a constraint violation, a bug) now propagates up and rolls
 * back the whole transaction via app/api/shared-state/route.ts's
 * `db.transaction()`.
 *
 * This is deliberately different from the per-record skip-and-log calls
 * throughout this file (e.g. "skipping subscription, unrecognized plan") -
 * those are expected, legitimate business outcomes (app.js's own
 * exceptions mechanism already flags the same rows as broken), not errors,
 * and still don't throw. Only genuinely unexpected failures propagate now.
 *
 * Known, deliberate simplifications (see docs/schema-design.md for the
 * full reasoning behind each):
 *  - address is stored as one opaque blob in address_line1; line2/city/
 *    state/zip are never populated (app.js never produces structured
 *    address fields to begin with).
 *  - subscriptions/mailings rows are skipped (not written) when the
 *    source data is already something app.js itself treats as broken
 *    (an unrecognized plan, or a missing ship date) - the blob stays the
 *    complete, authoritative copy regardless.
 *  - exceptions.type stores app.js's raw joined `reason` string, not the
 *    bad_address/missing_date/duplicate/unusual_sequence categories
 *    docs/schema-design.md originally sketched - those don't correspond,
 *    so forcing a category here would just be a different kind of guess.
 *  - reviewedException override keys are matched to an exceptions row via
 *    mailings.app_mailing_id (joined through exceptions.mailing_id) plus
 *    exceptions.type == the key's reason segment; the table has no column
 *    for the key's subscriberId/shipDate segments to cross-check against.
 *  - mailings.id is NOT app.js's own generated mailingId - see the column
 *    comment in db/schema/mailings.ts for why (it collides routinely for
 *    the most common subscription pattern) and what's used instead.
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

// Matches app.js's own plannedLetterCount() (public/app.js) for the three
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
  console.error("[dual-write]", ...args);
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

export async function dualWriteImport(seed: Seed, db: Db): Promise<void> {
  await runImport(seed, db);
}

async function runImport(seed: Seed, db: Db) {
  const recipientsById = new Map(seed.recipients.map((r) => [r.recipientId, r]));

  // Defense in depth against a future regression of the id-collision bug
  // this module's SeedRecipient/SeedSubscription ids depend on (see the
  // history note in lib/ids.ts): recompute each recipientId/subscriptionId
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
  const subscriptionOnlyExceptions: Array<{ subscriptionId: string; type: string }> = [];

  for (const e of seed.exceptions) {
    const entry = mailingByAppKey.get(appMailingKey(e));
    const candidateSubscriptionId = entry?.m.subscriptionId;
    const mailingResolvable = !!entry?.written;
    const stableMailingIdForException = mailingResolvable ? entry!.stableId : null;
    const subscriptionResolvable = !!candidateSubscriptionId && keepSubscriptionIds.has(candidateSubscriptionId);
    const type = e.reason || "";

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
        await db.insert(exceptions).values({ mailingId: stableMailingIdForException, subscriptionId, type });
      } else if (existing.length === 1) {
        await db.update(exceptions).set({ subscriptionId, type }).where(eq(exceptions.id, existing[0].id));
      } else {
        log("skipping exception update, multiple existing rows for mailing_id (unexpected):", stableMailingIdForException);
      }
      keptMailingExceptionIds.add(stableMailingIdForException!);
    } else {
      subscriptionOnlyExceptions.push({ subscriptionId: candidateSubscriptionId!, type });
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
  // reactively by dualWriteComponentStatus, see below) - but it still has
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

export async function dualWriteMailingStatus(key: string, status: string, db: Db): Promise<void> {
  const parsed = parseMailingKey(key);
  if (!parsed) {
    log("mailingStatus: could not parse key, skipping:", key);
    return;
  }
  const match = await findMailingByAppKey(parsed.mailingId, parsed.sourceRow, db);
  if (!match) return;
  await db.update(mailings).set({ status }).where(eq(mailings.id, match.id));
}

export async function dualWriteComponentStatus(key: string, status: string, db: Db): Promise<void> {
  const parsed = parseComponentKey(key);
  if (!parsed) {
    log("componentStatus: could not parse key, skipping:", key);
    return;
  }
  const match = await findMailingByAppKey(parsed.mailingId, parsed.sourceRow, db);
  if (!match) return;
  const existing = await db
    .select({ id: mailingComponents.id })
    .from(mailingComponents)
    .where(and(eq(mailingComponents.mailingId, match.id), eq(mailingComponents.componentType, parsed.field)));
  if (existing.length === 0) {
    await db.insert(mailingComponents).values({ mailingId: match.id, componentType: parsed.field, status });
  } else if (existing.length === 1) {
    await db
      .update(mailingComponents)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(mailingComponents.id, existing[0].id));
  } else {
    log("componentStatus: multiple existing rows for mailing+field (unexpected), skipping:", parsed);
  }
}

export async function dualWriteReviewedException(key: string, db: Db): Promise<void> {
  const parsed = parseExceptionReviewKey(key);
  if (!parsed) {
    log("reviewedException: could not parse key, skipping:", key);
    return;
  }
  // exceptionReviewKey carries no sourceRow, so exceptions can't be
  // disambiguated the same way mailings are - matched instead by joining
  // through to mailings.appMailingId plus exceptions.type (which this
  // module always writes as the exact reason string, so it doubles as a
  // real second signal here - see the module docstring). Subscription-only
  // fallback exceptions (mailing_id null) are never reachable this way;
  // that's an accepted, documented limitation.
  const rows = await db
    .select({ id: exceptions.id })
    .from(exceptions)
    .innerJoin(mailings, eq(exceptions.mailingId, mailings.id))
    .where(and(eq(mailings.appMailingId, parsed.mailingId), eq(exceptions.type, parsed.reason)));
  if (rows.length !== 1) {
    log(`reviewedException: expected exactly one matching exception, found ${rows.length}, skipping:`, parsed);
    return;
  }
  await db.update(exceptions).set({ reviewed: true, reviewedAt: sql`now()` }).where(eq(exceptions.id, rows[0].id));
}
