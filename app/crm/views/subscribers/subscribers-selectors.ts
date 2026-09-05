/**
 * Subscribers' own derivation, migrated from app/crm/legacy-app.js's
 * renderSubscribers()/subscriberProfile() (Phase 1 step 12 - CLAUDE.md,
 * the largest view migrated so far, and the last of the twelve besides
 * Envelope Print/Production Queue/QA/Packet/Bins). Two separate concerns
 * kept as two separate functions, matching the view's own two panes:
 * computeSubscriberRows() (the search-filtered grid, reusing
 * includesText() the same way every other view's search box does) and
 * computeSubscriberProfile() (the selected subscriber's open-mailings
 * table/cards, reusing the already-shared effectiveMailings()/
 * componentStatus() selectors - the same ones Production Queue/QA/Packet
 * already call).
 */

import type { Dataset, DatasetSubscriber } from "@/lib/domain/dataset";
import { activeExceptions, componentStatus, effectiveMailings, includesText, type EffectiveMailing } from "@/lib/client/selectors";
import { envelopeQuantityForMailing, numericLetter } from "@/lib/domain/plans";

// Same one-line rule as legacy's own printedEnvelopeStatusForMailing()
// (app/crm/legacy-app.js, still used there by Batch Print/QA's own bulk
// actions, so left in place rather than deleted) - duplicated here rather
// than exported, since it's a trivial ternary over an already-shared
// selector (envelopeQuantityForMailing), not real logic worth threading
// an extra export through for.
export function printedEnvelopeStatusForMailing(mailing: { envelopeQuantity: number }): string {
  return mailing.envelopeQuantity > 1 ? "Both Printed" : "Printed";
}

export function computeSubscriberRows(seed: Dataset, query: string): DatasetSubscriber[] {
  return seed.subscribers
    .filter((subscriber) => includesText([subscriber.displayName, subscriber.email, subscriber.subscriberId, subscriber.status, subscriber.openMailings], query))
    .slice(0, 80);
}

// legacy's own fallback: the previously-selected subscriber if they're
// still in the (possibly search-filtered) row list, else the first row,
// else nothing selected at all.
export function selectSubscriber(rows: DatasetSubscriber[], selectedSubscriberId: string): DatasetSubscriber | null {
  return rows.find((subscriber) => subscriber.subscriberId === selectedSubscriberId) || rows[0] || null;
}

// A profile opened from another view must resolve against every subscriber,
// not the 80-row list preview. Otherwise a valid customer outside that slice
// silently falls back to whichever customer happens to be shown first.
export function selectSubscriberForProfile(
  rows: DatasetSubscriber[],
  allSubscribers: DatasetSubscriber[],
  selectedSubscriberId: string,
  profileOpen: boolean,
): DatasetSubscriber | null {
  if (profileOpen) {
    return allSubscribers.find((subscriber) => subscriber.subscriberId === selectedSubscriberId) ?? null;
  }
  return selectSubscriber(rows, selectedSubscriberId);
}

export interface ProfileMailingRow extends EffectiveMailing {
  envelopeStatus: string;
  envelopeQuantity: number;
  needsDone: string;
  reviewReasons: string[];
}

export interface SubscriberProfileData {
  subscriber: DatasetSubscriber;
  allRows: ProfileMailingRow[];
  openRows: ProfileMailingRow[];
  recipientCount: number;
  totalMailings: number;
  totalEnvelopeCount: number;
  subscriptionChoices: Array<{ subscriptionId: string; character: string; plan: string; recipientName: string }>;
  customerReviewReasons: string[];
}

export function computeSubscriberProfile(
  seed: Dataset,
  statusOverrides: Record<string, string>,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  subscriber: DatasetSubscriber,
): SubscriberProfileData {
  const rows = effectiveMailings(seed, statusOverrides)
    .filter((mailing) => mailing.subscriberId === subscriber.subscriberId)
    .sort((a, b) => (a.shipDate || "9999").localeCompare(b.shipDate || "9999") || numericLetter(a.letterNumber) - numericLetter(b.letterNumber));
  const recipientIds = new Set(rows.map((mailing) => mailing.recipientId));
  const customerExceptions = activeExceptions(seed, reviewed).filter((item) => item.subscriberId === subscriber.subscriberId);
  const allRows: ProfileMailingRow[] = rows.map((mailing) => ({
      ...mailing,
      envelopeStatus: componentStatus(mailing, "envelope", seed, reviewed, componentOverrides),
      envelopeQuantity: envelopeQuantityForMailing(mailing),
      needsDone: componentStatus(mailing, "needsDone", seed, reviewed, componentOverrides),
      reviewReasons: customerExceptions.filter((item) => item.mailingId === mailing.mailingId).map((item) => item.reason),
    }));
  const openRows = allRows.filter((mailing) => mailing.status !== "Mailed" && mailing.activeState === "Active");
  const totalEnvelopeCount = openRows.reduce((total, mailing) => total + mailing.envelopeQuantity, 0);
  const subscriptionChoices = Array.from(
    new Map(
      allRows.map((mailing) => [
        mailing.subscriptionId,
        { subscriptionId: mailing.subscriptionId, character: mailing.character, plan: mailing.plan, recipientName: mailing.recipientName },
      ]),
    ).values(),
  );

  return {
    subscriber,
    allRows,
    openRows,
    recipientCount: recipientIds.size,
    totalMailings: rows.length,
    totalEnvelopeCount,
    subscriptionChoices,
    customerReviewReasons: Array.from(new Set(customerExceptions.map((item) => item.reason))),
  };
}
