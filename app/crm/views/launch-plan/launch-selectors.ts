/**
 * Launch Plan's own derivation - the six checklist items' status/detail
 * text and the today/next-batch pair, migrated from
 * app/crm/legacy-app.js's renderLaunch() (Phase 1 step 7 - CLAUDE.md).
 *
 * View-specific, not cross-view, so it lives beside its component rather
 * than in lib/client/selectors.ts: nothing else in the app needs "is the
 * go-live checklist ready," only this one screen. packetRows/
 * packetProblemRows - the piece Launch Plan *does* share with Batch
 * Packet - moved to lib/client/selectors.ts instead (see that module's
 * own header), which is the actual boundary this split is drawn on: view-
 * specific computation stays with its view, a derivation two views both
 * need becomes a shared selector. Automation had no derivation at all, so
 * step 6 never had to draw this line - this is the first place it
 * actually gets drawn.
 *
 * takes `today` as an explicit parameter rather than calling
 * todayIso(new Date()) itself - the exact pattern lib/domain/ spent three
 * branches establishing (todayIso(now), spreadsheetExceptionReasons(...,
 * today), buildSeedFromSpreadsheet(..., now)). The caller (app/crm/CrmApp.tsx)
 * computes `now` once; this function never reaches for the clock, which is
 * also what makes it possible to test deterministically with no
 * globalThis.Date patching - see tests/launch-selectors.test.mjs.
 *
 * Preserves one genuinely surprising piece of legacy coupling exactly,
 * rather than "fixing" it (out of scope - same computed values, no
 * behavior change): Launch Plan has no query box or packet-scope toggle
 * of its own, but its row counts still depend on state.query/
 * state.packetScope/state.batchFilter, because the packetRows() call
 * inside the legacy renderLaunch() inherited whatever those were last set
 * to elsewhere in the app (Batch Packet, mainly). That's preserved here
 * as explicit parameters this function's caller must supply from the same
 * `state` fields - surprising, but exactly what the legacy view already
 * did, and changing it would be a real behavior change this task is
 * explicitly not asking for.
 */

import type { Dataset } from "@/lib/domain/dataset";
import { formatDate } from "@/lib/domain/format";
import { envelopeQuantityForMailing } from "@/lib/domain/plans";
import { activeExceptions, nextBatchDate, packetProblemRows, packetRows, selectedBatchDate } from "@/lib/client/selectors";
import type { EffectiveMailing } from "@/lib/client/selectors";
import { number } from "../../format";

export interface LaunchChecklistItem {
  label: string;
  status: string;
  detail: string;
}

export interface LaunchPlanData {
  today: string;
  batchDate: string;
  highExceptionCount: number;
  checklist: LaunchChecklistItem[];
  roadmap: readonly (readonly [string, string])[];
}

// Static content, never computed - kept here (not in the component) so
// LaunchPlan.tsx stays pure rendering with no literals of its own to keep
// in sync if this text changes, matching where the equivalent static
// content (the 7 flow steps) lives in Automation.tsx.
export const LAUNCH_ROADMAP: readonly (readonly [string, string])[] = [
  ["Shared database", "Move local browser statuses into a real shared backend so Marcy and Ashley always see the same QA state."],
  ["Private hosted link", "Ashley can open the CRM from her computer or phone without using a zip file."],
  ["Mobile quick actions", "Make phones useful for lookup, status changes, Ashley bins, and mailing QA without fighting wide tables."],
  ["Squarespace sync", "Pull paid orders automatically so order IDs, dates, plans, and customer data are not hand-entered."],
  ["Mailchimp sample requests", "Website sample request creates a CRM lead, tags Kid or Adult in Mailchimp, and sends the correct sample letter."],
  ["Customer profile totals", "Track lifetime revenue, open mailings, completed letters, samples requested, and conversions in one place."],
];

export function computeLaunchPlanData(
  seed: Dataset,
  mailings: EffectiveMailing[],
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  batchFilter: string,
  packetScope: string,
  query: string,
  today: string,
): LaunchPlanData {
  // batchDate (for the hero "Next batch" card) and the batch date used to
  // filter the packet are genuinely different values in the legacy code -
  // renderLaunch() always shows the literal next batch, but packetRows()
  // filters by whatever batchFilter currently is (default 'next', but a
  // user could have it on 'all' or a specific past/future date from
  // elsewhere in the app). Preserved as two separate computations here,
  // not collapsed into one, for exactly that reason.
  const batchDate = nextBatchDate(mailings, today);
  const packetBatchDate = selectedBatchDate(batchFilter, mailings, today);
  const rows = packetRows(mailings, packetBatchDate, packetScope, query);
  const problemRows = packetProblemRows(rows, seed, reviewed, componentOverrides);
  const monthlyRows = rows.filter((mailing) => mailing.plan === "Month-to-month");
  const envelopeCount = rows.reduce((sum, mailing) => sum + envelopeQuantityForMailing(mailing), 0);
  const monthlyEnvelopeCount = monthlyRows.reduce((sum, mailing) => sum + envelopeQuantityForMailing(mailing), 0);
  const highExceptionCount = activeExceptions(seed, reviewed).filter((item) => item.severity === "High").length;

  const checklist: LaunchChecklistItem[] = [
    {
      label: "Use CRM as the mailing source of truth",
      status: "Ready",
      detail: `Next visible batch is ${formatDate(batchDate)}. Production Queue, Mailing QA, and Batch Packet are all built around that date.`,
    },
    {
      label: "Run the Batch Packet before assembly",
      status: rows.length ? "Ready" : "Check",
      detail: `${number(rows.length)} mailing rows and ${number(envelopeCount)} envelope pieces are in the current packet.`,
    },
    {
      label: "Print month-to-month envelopes in pairs",
      status: monthlyEnvelopeCount ? "Ready" : "Clear",
      detail: `${number(monthlyRows.length)} month-to-month mailing rows need ${number(monthlyEnvelopeCount)} envelopes because each paid month covers two letters.`,
    },
    {
      label: "Clear held/problem rows before printing",
      status: problemRows.length ? "Needs Review" : "Ready",
      detail: problemRows.length ? `${number(problemRows.length)} rows are held in this packet.` : "No held rows in the active packet.",
    },
    {
      label: "Give Ashley a shared version before Squarespace sync",
      status: "Next",
      detail: "Ashley needs the same live status data before we automate orders. The target is a usable shared link by Jul 22.",
    },
    {
      label: "Treat Mailchimp sample automation as phase two",
      status: "Later",
      detail: "Sample letters are saved and ready. Mailchimp can wait until the mailing process is stable.",
    },
  ];

  return { today, batchDate, highExceptionCount, checklist, roadmap: LAUNCH_ROADMAP };
}
