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
 *
 * packetRows/packetProblemRows moved here in Phase 1 step 7 (CLAUDE.md).
 * Step 4 deliberately left them in app/crm/legacy-app.js, reasoning they
 * were view-shaped assembly mixing UI-local filter state, used only by
 * Batch Packet - true at the time, wrong once Launch Plan needed the same
 * derivation (two views sharing one derivation is the actual definition
 * of a shared selector). packetRows takes `batchDate` as an explicit
 * input rather than computing it from `batchFilter` itself (unlike the
 * legacy version, which called selectedBatchDate() internally) - both
 * call sites already need that value for their own display purposes too,
 * so passing it once removes a duplicate computation without changing
 * the result (selectedBatchDate is pure).
 *
 * includesText moved here from app/crm/format.ts for the same reason
 * packetRows needed it: a `lib/client/` selector needing a view-only
 * helper would invert this codebase's import direction (lib/ is meant to
 * be consumed by app/, not the reverse) - and unlike escapeHtml/
 * statusClass/number (genuinely display-only: HTML escaping, CSS class
 * strings, locale number formatting), includesText's search-matching
 * logic is exactly the kind of cross-view derivation this file exists
 * for. app/crm/format.ts's own header comment predicted this exact
 * question when formatDate/titleCase made the same move in step 3c
 * ("nothing in lib/domain/ actually needs it") - this is the same move,
 * one layer over, now that something in lib/client/ does.
 *
 * qaIsReady/qaNeedsAttention moved here in Phase 1 step 14 (Mailing QA -
 * CLAUDE.md), same treatment packetRows got in step 7: Batch Packet's
 * still-legacy packetFinalRow() (app/crm/legacy-app.js) needs the exact
 * same ready/attention classification QA's own rows do, so this is a
 * shared selector, not a QA-view-only one - unlike qaRows() itself
 * (app/crm/views/qa/qa-selectors.ts), which only QA ever needed. Moved
 * unchanged: same field list (COMPONENT_FIELD_OPTIONS' keys, verified
 * identical to legacy's own qaFields order by
 * tests/component-fields-parity.test.mjs), same status-value lists.
 */

import type { Dataset, DatasetException, DatasetMailing, DatasetRecipient, DatasetSubscription } from "../domain/dataset";
import { componentKey, exceptionReviewKey, mailingKey } from "../domain/keys";
import { isOpenStatus } from "../domain/mailing-rules";
import { printModeForPlan } from "../domain/plans";
import { driveCharacterKey, envelopeStockForCharacter } from "../domain/characters";
import { COMPONENT_FIELD_OPTIONS } from "../domain/component-fields";

export function includesText(values: unknown[], query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

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

// "Everything is where it needs to be for mailing day" - payment collected,
// envelope/letter/artifact/insert all past their "still needs work" states,
// and QA itself marked Ready.
export function qaIsReady(mailing: DatasetMailing, seed: Dataset, reviewed: Set<string>, componentOverrides: Record<string, string>): boolean {
  return (
    componentStatus(mailing, "payment", seed, reviewed, componentOverrides) === "Active" &&
    ["Printed", "Both Printed", "In Ashley Box", "Not Needed"].includes(componentStatus(mailing, "envelope", seed, reviewed, componentOverrides)) &&
    ["Stuffed", "Not Needed"].includes(componentStatus(mailing, "letter", seed, reviewed, componentOverrides)) &&
    ["Packed", "Not Needed"].includes(componentStatus(mailing, "artifact", seed, reviewed, componentOverrides)) &&
    ["Packed", "Not Needed"].includes(componentStatus(mailing, "insert", seed, reviewed, componentOverrides)) &&
    componentStatus(mailing, "qa", seed, reviewed, componentOverrides) === "Ready"
  );
}

// At least one of the seven component fields is sitting in a status that
// means "someone still needs to look at this row" - not necessarily a
// problem, just not settled either way.
export function qaNeedsAttention(mailing: DatasetMailing, seed: Dataset, reviewed: Set<string>, componentOverrides: Record<string, string>): boolean {
  const statuses = Object.keys(COMPONENT_FIELD_OPTIONS).map((field) => componentStatus(mailing, field, seed, reviewed, componentOverrides));
  return statuses.some((status) => ["Need Print", "Need Check", "Needs Check", "CC Failed", "Paused", "Problem", "Open"].includes(status));
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

// The active packet: every mailing that would actually go out in the
// selected batch, in the order Batch Packet (and now Launch Plan) group
// and print work by. `batchDate` is the caller's already-resolved
// selectedBatchDate() result (see this file's own header for why it's a
// parameter here, not computed internally) - "" means "all open batches",
// matching selectedBatchDate's own "all"/"" convention.
export function packetRows(mailings: EffectiveMailing[], batchDate: string, packetScope: string, query: string): EffectiveMailing[] {
  return mailings
    .filter((mailing) => mailing.activeState === "Active")
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== "Mailed")
    .filter((mailing) => (packetScope === "monthly" ? mailing.plan === "Month-to-month" : true))
    .filter((mailing) =>
      includesText(
        [mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId],
        query,
      ),
    )
    .sort(
      (a, b) =>
        envelopeStockForCharacter(a.character).localeCompare(envelopeStockForCharacter(b.character)) ||
        driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character)) ||
        String(a.recipientName).localeCompare(String(b.recipientName)),
    );
}

// Rows within a packet that shouldn't go out yet - a real, unresolved High
// exception, a non-Active payment status, a QA "Problem" flag, or a
// missing ship date. `rows` is deliberately the caller's own packetRows()
// result (or any subset of it), not computed here - Batch Packet and
// Launch Plan both call this on their own already-filtered rows rather
// than this function re-deriving the packet from scratch.
export function packetProblemRows(
  rows: EffectiveMailing[],
  seed: Dataset,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
): EffectiveMailing[] {
  return rows.filter(
    (mailing) =>
      exceptionsForMailing(mailing, seed, reviewed).some((item) => item.severity === "High") ||
      componentStatus(mailing, "payment", seed, reviewed, componentOverrides) !== "Active" ||
      componentStatus(mailing, "qa", seed, reviewed, componentOverrides) === "Problem" ||
      !mailing.shipDate,
  );
}
