/**
 * Production Queue's own derivation, migrated from
 * app/crm/legacy-app.js's renderQueue() (Phase 1 step 13 - CLAUDE.md).
 * The busiest operational screen in the app, and the one most driven by
 * shell-owned controls: state.query (the search box), state.statusFilter,
 * and state.batchFilter are all owned by the shell, outside this view's
 * mount entirely (Subscribers, step 12, was the first view to depend on
 * one shell control - the search box; this one depends on all three).
 *
 * computeQueueRows() reuses every selector this filter chain already had
 * shared, tested implementations for: activeExceptions()/
 * effectiveMailings()/includesText() (lib/client/selectors.ts, shared
 * with every other view that needs them) and selectedBatchDate() (same
 * module - takes `today` explicitly, the one clock dependency in this
 * chain, threaded in by app/crm/CrmApp.tsx exactly like Launch Plan's
 * own today parameter). isOpenStatus comes directly from
 * lib/domain/mailing-rules.ts, same as legacy's own import.
 */

import type { Dataset } from "@/lib/domain/dataset";
import { activeExceptions, effectiveMailings, includesText, selectedBatchDate, type EffectiveMailing } from "@/lib/client/selectors";
import { isOpenStatus } from "@/lib/domain/mailing-rules";

export interface QueueData {
  rows: EffectiveMailing[];
  batchDate: string;
}

export function computeQueueRows(
  seed: Dataset,
  statusOverrides: Record<string, string>,
  reviewed: Set<string>,
  batchFilter: string,
  statusFilter: string,
  query: string,
  today: string,
): QueueData {
  const highExceptionMailingIds = new Set(
    activeExceptions(seed, reviewed)
      .filter((item) => item.severity === "High")
      .map((item) => item.mailingId),
  );
  const effMailings = effectiveMailings(seed, statusOverrides);
  const batchDate = selectedBatchDate(batchFilter, effMailings, today);
  const rows = effMailings
    .filter((mailing) => mailing.activeState === "Active")
    .filter((mailing) => !highExceptionMailingIds.has(mailing.mailingId))
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => {
      if (statusFilter === "Open") return isOpenStatus(mailing.status);
      if (statusFilter === "All") return true;
      return new Set(statusFilter.split("|").filter(Boolean)).has(mailing.status);
    })
    .filter((mailing) => includesText([mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId], query))
    .slice(0, 120);

  return { rows, batchDate };
}
