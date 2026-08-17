/**
 * Sync Simulator's own derivation - the subscriber/subscription option
 * lists and the generated-mailings preview, migrated from
 * app/crm/legacy-app.js's getSyncPreview()/renderSync() (Phase 1 step 8 -
 * CLAUDE.md). View-specific, not cross-view (nothing else needs "what
 * would a simulated renewal generate"), so it lives beside its component -
 * same boundary step 7 (Launch Plan) drew between lib/client/selectors.ts
 * (shared across views) and a view's own -selectors.ts (used by one).
 *
 * Fully clock-free, unlike Launch Plan's derivation: batchDatesForOrder()
 * (lib/domain/batch-dates.ts) derives every date from `orderDate` itself,
 * never from `new Date()` - confirmed by reading it, not assumed - so
 * nothing here takes a `today`/`now` parameter at all. Still worth stating
 * explicitly: this view is deterministic given its inputs, which is what
 * tests/sync-selectors.test.mjs's determinism test actually proves rather
 * than asserts.
 *
 * The `Â·` separator below is not a typo - it's the exact mojibake
 * character sequence (U+00C2 U+00B7) the legacy renderSync()/getSyncPreview()
 * already emit (CLAUDE.md §8 already tracks this as a known, separate
 * encoding issue - "normalize encoding while preserving intended
 * display"). Out of scope here: "same markup... same option lists" means
 * reproducing it exactly, not fixing it as a drive-by.
 *
 * defaultSyncSubscriberId/defaultSyncSubscriptionId are pure decisions,
 * not mutations - legacy renderSync() computed AND assigned this default
 * inline ("if (!state.syncSubscriberId) { state.syncSubscriberId = ... }").
 * That assignment is a `state` mutation, which can't happen in a pure
 * selector - app/crm/CrmApp.tsx (the one place already allowed to touch
 * `state` for a React-hosted view) calls these and does the actual
 * assignment, mirroring the legacy control flow exactly without this
 * module ever touching `state` itself.
 */

import type { Dataset, DatasetSubscriber, DatasetSubscription } from "@/lib/domain/dataset";
import { findSubscriptionMailings, getRecipientName, getSubscriberSubscriptions } from "@/lib/client/selectors";
import { numericLetter, plannedLetterCount } from "@/lib/domain/plans";
import { batchDatesForOrder } from "@/lib/domain/batch-dates";

export interface SyncOption {
  value: string;
  label: string;
  selected: boolean;
}

export interface SyncGeneratedRow {
  letterNumber: number;
  shipDate: string;
  mailingId: string;
}

export interface SyncPreviewData {
  subscriber: DatasetSubscriber;
  subscription: DatasetSubscription;
  // The selected subscription's recipient name, resolved once here (not
  // left for the component to resolve) - the component only receives this
  // already-computed data, never `seed` itself, matching Automation/
  // LaunchPlan's existing shape.
  recipientName: string;
  subscriberOptions: SyncOption[];
  subscriptionOptions: SyncOption[];
  plan: string;
  orderDate: string;
  existingCount: number;
  currentMax: number;
  newCount: number;
  generated: SyncGeneratedRow[];
}

export function defaultSyncSubscriberId(seed: Dataset): string {
  const active = seed.subscribers.find((subscriber) => subscriber.status === "Active") || seed.subscribers[0];
  return active?.subscriberId ?? "";
}

export function defaultSyncSubscriptionId(subscriberId: string, seed: Dataset): string {
  return getSubscriberSubscriptions(subscriberId, seed)[0]?.subscriptionId ?? "";
}

export function computeSyncPreview(seed: Dataset, syncSubscriberId: string, syncSubscriptionId: string, syncPlan: string, syncOrderDate: string): SyncPreviewData {
  const subscriber = seed.subscribers.find((item) => item.subscriberId === syncSubscriberId) || seed.subscribers[0];
  const subscriptions = getSubscriberSubscriptions(subscriber.subscriberId, seed);
  const subscription = subscriptions.find((item) => item.subscriptionId === syncSubscriptionId) || subscriptions[0] || seed.subscriptions[0];
  const existing = findSubscriptionMailings(subscription.subscriptionId, seed);
  const currentMax = existing.reduce((max, mailing) => Math.max(max, numericLetter(mailing.letterNumber)), 0);
  const newCount = plannedLetterCount(syncPlan);
  const shipDates = batchDatesForOrder(syncOrderDate, newCount);
  const generated: SyncGeneratedRow[] = shipDates.map((shipDate, index) => ({
    letterNumber: currentMax + index + 1,
    shipDate,
    mailingId: `SIM-${subscription.subscriptionId}-${shipDate.replaceAll("-", "")}-L${currentMax + index + 1}`,
  }));

  const subscriberOptions: SyncOption[] = seed.subscribers
    .filter((item) => item.status === "Active")
    .slice(0, 120)
    .map((item) => ({
      value: item.subscriberId,
      label: `${item.displayName} Â· ${item.email || item.subscriberId}`,
      selected: item.subscriberId === subscriber.subscriberId,
    }));

  const subscriptionOptions: SyncOption[] = subscriptions.map((item) => ({
    value: item.subscriptionId,
    label: `${getRecipientName(item.recipientId, seed)} Â· ${item.character} Â· ${item.plan}`,
    selected: item.subscriptionId === subscription.subscriptionId,
  }));

  return {
    subscriber,
    subscription,
    recipientName: getRecipientName(subscription.recipientId, seed),
    subscriberOptions,
    subscriptionOptions,
    plan: syncPlan,
    orderDate: syncOrderDate,
    existingCount: existing.length,
    currentMax,
    newCount,
    generated,
  };
}
