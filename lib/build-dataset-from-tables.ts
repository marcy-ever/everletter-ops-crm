/**
 * Reconstructs app.js's full crmDataset shape (app/crm/legacy-app.js's
 * buildSeedFromSpreadsheet output) by querying the normalized tables
 * (db/schema/) directly. app/api/shared-state/route.ts's GET handler calls
 * buildDatasetFromTables() for this; there is no other read path and
 * nothing is cached in between. The Dataset/DatasetX types themselves live
 * in lib/domain/dataset.ts - the canonical shape both this module and
 * buildSeedFromSpreadsheet (lib/domain/spreadsheet/build-seed.ts) return,
 * enforced by the type system instead of two independently-maintained
 * interface sets.
 *
 * lib/write-to-tables.ts writes every import into these tables; this
 * module is what reads them back. Composed from one small,
 * independently-testable builder function per output entity
 * (buildSubscribers/buildRecipients/buildOrders/buildSubscriptions/
 * buildMailings/buildExceptions/buildSummary), mirroring the real shape of
 * the problem - each output has its own aggregation logic, and tests for
 * one shouldn't need to construct fixtures for the other six. buildMailings
 * runs first; every other builder reuses its output for per-record fields
 * (overdue, dueNext14Days, activeState, etc.) instead of recomputing the
 * same business rules independently - see lib/mailing-rules.ts, the same
 * canonical-shared-logic pattern lib/ids.ts and lib/keys.ts already
 * establish.
 *
 * `overdue`/`dueNext14Days`/`summary.asOf` are computed LIVE here (using
 * the `now` passed to buildDatasetFromRows/buildDatasetFromTables, default
 * "right now"), not frozen at import time the way app.js's client-side
 * computation is - a deliberate behavior improvement, not a bug; see
 * lib/mailing-rules.ts's module comment.
 *
 * Known, documented gaps - fields app.js's original seed has that the
 * normalized schema doesn't currently persist, or can only partially
 * recover. None of these are bugs in this module; each would need a
 * lib/write-to-tables.ts (write-path) change to close.
 *
 *  - summary.sourceFile: always "" unless the caller supplies one
 *    explicitly (see buildDatasetFromTables's `sourceFile` param). Nothing
 *    in the normalized tables records which spreadsheet file produced the
 *    current data. Would need a real column (e.g. on ingestion_events,
 *    which exists in the schema but nothing writes to yet) to close.
 *  - mailings[].orderDate: "" for a mailing whose order was skipped by
 *    lib/write-to-tables.ts (no resolvable/kept subscription at import time -
 *    see runImport's orders loop). Doesn't manifest for orders backed by a
 *    kept subscription, which is the overwhelming common case.
 *  - subscribers[].status / subscribers[].firstOrderDate: app.js freezes
 *    these from whichever spreadsheet row happened to be processed FIRST
 *    for that subscriber (a Map-insertion-order artifact - row order isn't
 *    preserved anywhere in the normalized schema, only per-mailing
 *    lastSourceRow). This module uses well-defined aggregates instead:
 *    status is "Active" if ANY of the subscriber's subscriptions is
 *    Active (else "Archived"), and firstOrderDate is the EARLIEST known
 *    orderedAt across the subscriber's orders. These can differ from
 *    app.js's frozen value when the source spreadsheet isn't ordered
 *    chronologically per subscriber - a real, if narrow, edge case.
 *  - exceptions[] for the "subscription-only fallback" case (the
 *    exception's mailing itself was skipped by lib/write-to-tables.ts, e.g. for
 *    a missing ship date - see docs/schema-design.md's dual-write notes):
 *    mailingId, shipDate, suggestedShipDate, and status can't be recovered
 *    (nothing links back to app.js's original mailingId for these), so
 *    they're "". sourceRow is `null` for this case specifically (not ""
 *    - see DatasetException/lib/domain/dataset.ts: `null` means "genuinely
 *    unrecoverable," distinct from any real row number, and the app.js's
 *    own client-built exceptions can never produce it, since a client-side
 *    exception is always built directly from a row already in hand).
 *    exceptionId falls back to `EX-DB-${row.id}` (the exceptions table's
 *    own serial id) instead of app.js's `EX-${sourceRow}` format, clearly
 *    distinguishable as reconstructed rather than original.
 *    reason/subscriberId/recipientName ARE fully recoverable for this case
 *    (via subscriptionId) and are populated normally.
 *  - recipients[] omits any recipient whose EVERY subscription has an
 *    unrecognized plan (see LETTERS_BY_PLAN in lib/write-to-tables.ts) - since
 *    recipients are derived by grouping the `subscriptions` table (there's
 *    no separate recipients table - see docs/schema-design.md), and
 *    lib/write-to-tables.ts never writes a subscription row for an
 *    unrecognized plan at all, that recipient has nothing left to group
 *    from. app.js's own recipients list has no such gap - it's built per
 *    row regardless of plan validity, before any skip logic applies.
 *  - Array order for subscribers/recipients/mailings can differ from
 *    app.js's within a group of records that sort EQUAL on the array's
 *    sort key (e.g. several subscribers all with the same `nextShipDate`).
 *    Both sides use a stable sort, but app.js's pre-sort order is
 *    spreadsheet row order, while this module's is whatever order
 *    `db.select().from(...)` returns rows in - the normalized schema
 *    doesn't preserve cross-entity row order (only mailings.lastSourceRow,
 *    which is per-mailing). Records within a tie are individually still
 *    correct, just not necessarily in the same relative order.
 *
 * All of the above were found and precisely root-caused by running
 * tests/build-dataset-from-tables.e2e.test.mjs against the real 1,218-row
 * test spreadsheet - see that file's ALLOWED_DISCREPANCIES for the exact,
 * verified signature of every one of them. Anything outside that allowlist
 * fails the test.
 */

import { getDb } from "../db";
import { subscribers } from "../db/schema/subscribers";
import { subscriptions } from "../db/schema/subscriptions";
import { orders } from "../db/schema/orders";
import { mailings } from "../db/schema/mailings";
import { exceptions } from "../db/schema/exceptions";
import { buildRecipientId } from "./domain/ids";
import { isOpenStatus, isOverdueMailing, isDueNext14Days, todayIso, monthKey, nearestBatchDate } from "./domain/mailing-rules";
import type { Dataset, DatasetSubscriber, DatasetRecipient, DatasetOrder, DatasetSubscription, DatasetMailing, DatasetException, DatasetSummary } from "./domain/dataset";

export type SubscriberRow = typeof subscribers.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type MailingRow = typeof mailings.$inferSelect;
export type ExceptionRow = typeof exceptions.$inferSelect;

function toIsoDateOrEmpty(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// mailings.id is `${orderId}::${character}::${letterNumber}` (see
// db/schema/mailings.ts's column comment) - orderId is fully recoverable by
// splitting on the same "::" separator, without needing its own column.
function orderIdFromStableMailingId(stableId: string): string {
  return stableId.split("::")[0] ?? "";
}

export function buildMailings(
  mailingRows: MailingRow[],
  subscriptionsById: Map<string, SubscriptionRow>,
  subscribersById: Map<string, SubscriberRow>,
  ordersById: Map<string, OrderRow>,
  today: string,
): DatasetMailing[] {
  const out: DatasetMailing[] = [];
  for (const row of mailingRows) {
    const subscription = subscriptionsById.get(row.subscriptionId);
    if (!subscription) continue; // FK guarantees this in practice; skip defensively rather than throw.
    const subscriber = subscribersById.get(subscription.subscriberId);
    const orderId = orderIdFromStableMailingId(row.id);
    const order = ordersById.get(orderId);
    const recipientId = buildRecipientId({
      subscriberId: subscription.subscriberId,
      recipientName: subscription.recipientName,
      address: subscription.addressLine1 ?? "",
    });
    const shipDate = row.scheduledDate;
    const activeState = row.active ? "Active" : "Archived"; // per-row, not the subscription's - see db/schema/mailings.ts
    const status = row.status;

    out.push({
      mailingId: row.appMailingId,
      subscriberId: subscription.subscriberId,
      recipientId,
      orderId,
      orderDate: toIsoDateOrEmpty(order?.orderedAt),
      subscriptionId: row.subscriptionId,
      recipientName: row.recipientName,
      email: subscriber?.email ?? "",
      character: subscription.character,
      plan: subscription.termType,
      letterNumber: row.letterNumber === null ? "" : String(row.letterNumber),
      shipDate,
      suggestedShipDate: nearestBatchDate(shipDate),
      status,
      activeState,
      notes: row.notes ?? "",
      overdue: isOverdueMailing({ activeState, status, shipDate }, today),
      dueNext14Days: isDueNext14Days({ activeState, status, shipDate }, today),
      sourceRow: Number(row.lastSourceRow),
    });
  }
  return out.sort((a, b) => (a.shipDate || "9999").localeCompare(b.shipDate || "9999"));
}

export function buildRecipients(subscriptionRows: SubscriptionRow[], mailings: DatasetMailing[]): DatasetRecipient[] {
  const groups = new Map<string, { subscriberId: string; name: string; address: string; characters: Set<string> }>();
  for (const s of subscriptionRows) {
    const address = s.addressLine1 ?? "";
    const recipientId = buildRecipientId({ subscriberId: s.subscriberId, recipientName: s.recipientName, address });
    if (!groups.has(recipientId)) {
      groups.set(recipientId, { subscriberId: s.subscriberId, name: s.recipientName, address, characters: new Set() });
    }
    groups.get(recipientId)!.characters.add(s.character);
  }

  const out: DatasetRecipient[] = [];
  for (const [recipientId, group] of groups) {
    const own = mailings.filter((m) => m.recipientId === recipientId);
    const openShipDates = own
      .filter((m) => m.activeState === "Active" && isOpenStatus(m.status) && m.shipDate)
      .map((m) => m.shipDate);
    out.push({
      recipientId,
      subscriberId: group.subscriberId,
      name: group.name,
      address: group.address,
      characters: Array.from(group.characters).sort(),
      totalMailings: own.length,
      nextShipDate: openShipDates.length ? openShipDates.reduce((min, d) => (d < min ? d : min)) : "",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSubscribers(
  subscriberRows: SubscriberRow[],
  subscriptionRows: SubscriptionRow[],
  orderRows: OrderRow[],
  mailings: DatasetMailing[],
  exceptions: DatasetException[],
): DatasetSubscriber[] {
  const subscriptionsBySubscriber = new Map<string, SubscriptionRow[]>();
  for (const s of subscriptionRows) {
    if (!subscriptionsBySubscriber.has(s.subscriberId)) subscriptionsBySubscriber.set(s.subscriberId, []);
    subscriptionsBySubscriber.get(s.subscriberId)!.push(s);
  }
  const subscriptionsById = new Map(subscriptionRows.map((s) => [s.id, s]));
  const ordersBySubscriber = new Map<string, OrderRow[]>();
  for (const o of orderRows) {
    const subscriberId = subscriptionsById.get(o.subscriptionId)?.subscriberId;
    if (!subscriberId) continue;
    if (!ordersBySubscriber.has(subscriberId)) ordersBySubscriber.set(subscriberId, []);
    ordersBySubscriber.get(subscriberId)!.push(o);
  }

  return subscriberRows
    .map((s) => {
      const own = mailings.filter((m) => m.subscriberId === s.id);
      const openOwn = own.filter((m) => m.activeState === "Active" && isOpenStatus(m.status));
      const openShipDates = openOwn.filter((m) => m.shipDate).map((m) => m.shipDate);
      const subscriberSubscriptions = subscriptionsBySubscriber.get(s.id) ?? [];
      const subscriberOrders = ordersBySubscriber.get(s.id) ?? [];
      const orderDates = subscriberOrders.map((o) => toIsoDateOrEmpty(o.orderedAt)).filter(Boolean);

      return {
        subscriberId: s.id,
        email: s.email,
        displayName: s.name,
        status: subscriberSubscriptions.some((sub) => sub.status === "Active") ? "Active" : "Archived",
        firstOrderDate: orderDates.length ? orderDates.reduce((min, d) => (d < min ? d : min)) : "",
        openMailings: openOwn.length,
        totalMailings: own.length,
        nextShipDate: openShipDates.length ? openShipDates.reduce((min, d) => (d < min ? d : min)) : "",
        issueCount: exceptions.filter((e) => e.subscriberId === s.id).length,
      };
    })
    .sort((a, b) => (a.nextShipDate || "9999").localeCompare(b.nextShipDate || "9999"));
}

export function buildOrders(orderRows: OrderRow[], subscriptionsById: Map<string, SubscriptionRow>): DatasetOrder[] {
  return orderRows
    .map((o) => {
      const subscription = subscriptionsById.get(o.subscriptionId);
      const createdOn = toIsoDateOrEmpty(o.orderedAt);
      return {
        orderId: o.id,
        subscriberId: subscription?.subscriberId ?? "",
        sourceOrderNumber: o.externalOrderNumber,
        createdOn,
        billingMonth: monthKey(createdOn),
        plan: subscription?.termType ?? "",
        status: "Imported",
        amount: "",
      };
    })
    .sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn)));
}

export function buildSubscriptions(subscriptionRows: SubscriptionRow[], mailings: DatasetMailing[]): DatasetSubscription[] {
  return subscriptionRows
    .map((s) => {
      const recipientId = buildRecipientId({ subscriberId: s.subscriberId, recipientName: s.recipientName, address: s.addressLine1 ?? "" });
      return {
        subscriptionId: s.id,
        subscriberId: s.subscriberId,
        recipientId,
        plan: s.termType,
        character: s.character,
        startDate: toIsoDateOrEmpty(s.startedAt),
        endDate: toIsoDateOrEmpty(s.endedAt),
        activeState: s.status,
        generatedMailings: mailings.filter((m) => m.subscriptionId === s.id).length,
      };
    })
    .sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));
}

export function buildExceptions(
  exceptionRows: ExceptionRow[],
  mailingsByStableId: Map<string, MailingRow>,
  mailingsByAppId: Map<string, DatasetMailing>,
  subscriptionsById: Map<string, SubscriptionRow>,
): DatasetException[] {
  return exceptionRows
    .map((e) => {
      const reason = e.type;
      const severity: "High" | "Low" = reason.includes("Missing") || reason.includes("ship date") ? "High" : "Low";
      const subscription = e.subscriptionId ? subscriptionsById.get(e.subscriptionId) : undefined;
      const subscriberId = subscription?.subscriberId ?? "";

      if (e.mailingId) {
        const stableMailing = mailingsByStableId.get(e.mailingId);
        const mailing = stableMailing ? mailingsByAppId.get(stableMailing.appMailingId) : undefined;
        if (mailing) {
          return {
            exceptionId: `EX-${mailing.sourceRow}`,
            severity,
            reason,
            mailingId: mailing.mailingId,
            subscriberId: mailing.subscriberId,
            recipientName: mailing.recipientName,
            shipDate: mailing.shipDate,
            suggestedShipDate: reason.toLowerCase().includes("ship date") ? mailing.suggestedShipDate : "",
            status: mailing.status,
            sourceRow: mailing.sourceRow,
          };
        }
      }

      // Subscription-only fallback: the exception's mailing was skipped by
      // lib/write-to-tables.ts, so mailingId/shipDate/suggestedShipDate/status
      // can't be recovered - see module comment. sourceRow is `null`
      // specifically (not "") - null means "genuinely unrecoverable," not
      // "empty string as a row number."
      return {
        exceptionId: `EX-DB-${e.id}`,
        severity,
        reason,
        mailingId: "",
        subscriberId,
        recipientName: subscription?.recipientName ?? "",
        shipDate: "",
        suggestedShipDate: "",
        status: "",
        sourceRow: null,
      };
    })
    .sort((a, b) => b.severity.localeCompare(a.severity) || String(a.shipDate || "").localeCompare(String(b.shipDate || "")));
}

export function buildSummary(
  subscribersOut: DatasetSubscriber[],
  recipientsOut: DatasetRecipient[],
  ordersOut: DatasetOrder[],
  subscriptionsOut: DatasetSubscription[],
  mailingsOut: DatasetMailing[],
  exceptionsOut: DatasetException[],
  sourceFile: string,
  today: string,
): DatasetSummary {
  return {
    asOf: today,
    sourceFile,
    subscriberCount: subscribersOut.length,
    activeSubscriberCount: subscribersOut.filter((s) => s.status === "Active").length,
    archivedSubscriberCount: subscribersOut.filter((s) => s.status !== "Active").length,
    recipientCount: recipientsOut.length,
    orderCount: ordersOut.length,
    subscriptionCount: subscriptionsOut.length,
    mailingCount: mailingsOut.length,
    openMailingCount: mailingsOut.filter((m) => m.activeState === "Active" && isOpenStatus(m.status)).length,
    archivedMailingCount: mailingsOut.filter((m) => m.activeState !== "Active").length,
    overdueCount: mailingsOut.filter((m) => m.activeState === "Active" && m.overdue).length,
    dueNext14Count: mailingsOut.filter((m) => m.activeState === "Active" && m.dueNext14Days).length,
    exceptionCount: exceptionsOut.length,
    missingShipDateCount: exceptionsOut.filter((e) => e.reason.includes("ship date")).length,
  };
}

export interface BuildDatasetFromRowsInput {
  subscriberRows: SubscriberRow[];
  subscriptionRows: SubscriptionRow[];
  orderRows: OrderRow[];
  mailingRows: MailingRow[];
  exceptionRows: ExceptionRow[];
  now: Date;
  sourceFile?: string;
}

// Thin composition: query results in, seven-entity Dataset out. No DB
// access of its own - buildDatasetFromTables (below) is the only thing
// that touches Drizzle, which is what makes this function usable directly
// from unit tests with hand-constructed row fixtures.
export function buildDatasetFromRows({
  subscriberRows,
  subscriptionRows,
  orderRows,
  mailingRows,
  exceptionRows,
  now,
  sourceFile = "",
}: BuildDatasetFromRowsInput): Dataset {
  const today = todayIso(now);
  const subscriptionsById = new Map(subscriptionRows.map((s) => [s.id, s]));
  const subscribersById = new Map(subscriberRows.map((s) => [s.id, s]));
  const ordersById = new Map(orderRows.map((o) => [o.id, o]));
  const mailingsByStableId = new Map(mailingRows.map((m) => [m.id, m]));

  const mailingsOut = buildMailings(mailingRows, subscriptionsById, subscribersById, ordersById, today);
  const mailingsByAppId = new Map(mailingsOut.map((m) => [m.mailingId, m]));

  const recipientsOut = buildRecipients(subscriptionRows, mailingsOut);
  const ordersOut = buildOrders(orderRows, subscriptionsById);
  const subscriptionsOut = buildSubscriptions(subscriptionRows, mailingsOut);
  const exceptionsOut = buildExceptions(exceptionRows, mailingsByStableId, mailingsByAppId, subscriptionsById);
  const subscribersOut = buildSubscribers(subscriberRows, subscriptionRows, orderRows, mailingsOut, exceptionsOut);
  const summary = buildSummary(subscribersOut, recipientsOut, ordersOut, subscriptionsOut, mailingsOut, exceptionsOut, sourceFile, today);

  return {
    summary,
    subscribers: subscribersOut,
    recipients: recipientsOut,
    orders: ordersOut,
    subscriptions: subscriptionsOut,
    mailings: mailingsOut,
    exceptions: exceptionsOut,
    automationRules: [],
  };
}

export async function buildDatasetFromTables(now: Date = new Date(), sourceFile = ""): Promise<Dataset> {
  const db = getDb();
  const [subscriberRows, subscriptionRows, orderRows, mailingRows, exceptionRows] = await Promise.all([
    db.select().from(subscribers),
    db.select().from(subscriptions),
    db.select().from(orders),
    db.select().from(mailings),
    db.select().from(exceptions),
  ]);
  return buildDatasetFromRows({ subscriberRows, subscriptionRows, orderRows, mailingRows, exceptionRows, now, sourceFile });
}
