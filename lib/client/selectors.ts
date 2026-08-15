/**
 * Cross-view selectors: pure derivations over a Dataset plus the client-side
 * override state (statusOverrides/componentOverrides/reviewed), and a few
 * plain lookups into the dataset by id. Extracted from app/crm/legacy-app.js
 * (step 4 of the app.js decomposition - see CLAUDE.md).
 *
 * Every function here takes its inputs explicitly rather than reading a
 * `state` global - that's what makes them independently testable, and it's
 * the shape the React views will need once they migrate in Phase 1.
 * app/crm/legacy-app.js keeps one-line adapters that pass its own `state`
 * (see the comment above those adapters there) - deliberate, transitional
 * scaffolding, not architecture.
 *
 * The batch-date selectors take `today` (an ISO "YYYY-MM-DD" string, from
 * todayIso()) as an explicit parameter rather than reading the clock
 * themselves, matching the established pattern in lib/domain/mailing-rules.ts.
 *
 * Finding worth flagging (see this step's PR description): componentStatus
 * and defaultComponentStatus depend on more than their names suggest. Both
 * read `componentOverrides` as expected, but defaultComponentStatus's
 * 'payment'/'qa' branches also depend on whether the mailing has an active
 * High-severity exception - which pulls in `seed` and `reviewed` too, via
 * exceptionsForMailing/activeExceptions. A change to a mailing's exceptions
 * can change its default component status even though no component
 * override changed at all.
 */

import type { Dataset, DatasetException, DatasetMailing, DatasetRecipient, DatasetSubscription } from "../domain/dataset";
import { componentKey, exceptionReviewKey, mailingKey } from "../domain/keys";
import { isOpenStatus } from "../domain/mailing-rules";
import { printModeForPlan } from "../domain/plans";
import { driveCharacterKey } from "../domain/characters";

export function isExceptionReviewed(item: DatasetException, reviewed: Set<string>): boolean {
  return reviewed.has(exceptionReviewKey(item)) || reviewed.has(item.exceptionId);
}

export function activeExceptions(seed: Dataset, reviewed: Set<string>): DatasetException[] {
  return seed.exceptions.filter((item) => !isExceptionReviewed(item, reviewed));
}

export interface EffectiveMailing extends DatasetMailing {
  originalStatus: string;
}

export function effectiveMailing(mailing: DatasetMailing, statusOverrides: Record<string, string>): EffectiveMailing {
  return {
    ...mailing,
    originalStatus: mailing.status,
    status: statusOverrides[mailingKey(mailing)] || mailing.status,
  };
}

export function effectiveMailings(seed: Dataset, statusOverrides: Record<string, string>): EffectiveMailing[] {
  return seed.mailings.map((mailing) => effectiveMailing(mailing, statusOverrides));
}

export function exceptionsForMailing(mailing: { mailingId: string }, seed: Dataset, reviewed: Set<string>): DatasetException[] {
  return activeExceptions(seed, reviewed).filter((item) => item.mailingId === mailing.mailingId);
}

export function defaultComponentStatus(mailing: DatasetMailing, field: string, seed: Dataset, reviewed: Set<string>): string {
  const issues = exceptionsForMailing(mailing, seed, reviewed);
  const hasHighIssue = issues.some((item) => item.severity === "High");
  const isPrepaid = printModeForPlan(mailing.plan) === "Prepaid bulk";

  if (field === "payment") return hasHighIssue ? "Needs Check" : "Active";
  if (field === "envelope") return isPrepaid ? "In Ashley Box" : "Need Print";
  if (field === "letter") return isPrepaid ? "Stuffed" : "Need Print";
  if (field === "artifact") return "Need Check";
  if (field === "insert") return ["marley", "oliver"].includes(driveCharacterKey(mailing.character)) ? "Need Check" : "Not Needed";
  if (field === "location") return isPrepaid ? "Ashley" : "Marcy";
  if (field === "qa") return hasHighIssue ? "Problem" : "Open";
  return "";
}

export function componentStatus(
  mailing: DatasetMailing,
  field: string,
  seed: Dataset,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
): string {
  return componentOverrides[componentKey(mailing, field)] || defaultComponentStatus(mailing, field, seed, reviewed);
}

export function availableBatchDates(mailings: EffectiveMailing[], today: string): string[] {
  return Array.from(
    new Set(
      mailings
        .filter((mailing) => mailing.activeState === "Active" && isOpenStatus(mailing.status) && mailing.shipDate && mailing.shipDate >= today)
        .map((mailing) => mailing.shipDate),
    ),
  ).sort();
}

export function pastBatchDates(mailings: EffectiveMailing[], today: string): string[] {
  return Array.from(
    new Set(mailings.filter((mailing) => mailing.activeState === "Active" && mailing.shipDate && mailing.shipDate < today).map((mailing) => mailing.shipDate)),
  )
    .sort()
    .reverse();
}

export function nextBatchDate(mailings: EffectiveMailing[], today: string): string {
  const dates = availableBatchDates(mailings, today);
  const upcoming = dates.find((date) => date >= today);
  return upcoming || dates[0] || "";
}

export function selectedBatchDate(batchFilter: string, mailings: EffectiveMailing[], today: string): string {
  if (batchFilter === "next") return nextBatchDate(mailings, today);
  if (batchFilter === "all") return "";
  return batchFilter;
}

export function findSubscriptionMailings(subscriptionId: string, seed: Dataset): DatasetMailing[] {
  return seed.mailings.filter((mailing) => mailing.subscriptionId === subscriptionId);
}

export function getSubscriberSubscriptions(subscriberId: string, seed: Dataset): DatasetSubscription[] {
  return seed.subscriptions
    .filter((subscription) => subscription.subscriberId === subscriberId)
    .sort((a, b) => `${a.character}-${a.plan}`.localeCompare(`${b.character}-${b.plan}`));
}

export function getRecipientName(recipientId: string, seed: Dataset): string {
  const recipient = seed.recipients.find((item) => item.recipientId === recipientId);
  return recipient?.name || "Unknown recipient";
}

export function getRecipient(recipientId: string, seed: Dataset): DatasetRecipient | null {
  return seed.recipients.find((item) => item.recipientId === recipientId) || null;
}
