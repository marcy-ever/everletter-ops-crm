/**
 * Batch Print's own derivation, migrated from app/crm/legacy-app.js's
 * renderPrint()/printRow() (Phase 1 step 17 - CLAUDE.md), the last of
 * twelve views. The generator itself (envelopeHtml() and everything it
 * depends on) lives in ./envelope-html.ts, relocated unchanged - see that
 * module's own header. This file is everything else: the filter chain,
 * the envelope-stock groupings, and each row's Drive-link/status display
 * data.
 *
 * Reused, not reimplemented: componentStatus/effectiveMailings/
 * activeExceptions/selectedBatchDate/includesText (shared since step 4).
 *
 * driveConfig is threaded in as an explicit parameter rather than
 * imported from app/crm/legacy-app.js directly - same pattern every other
 * view-selectors file in this migration uses for a legacy dependency
 * (letterFolderUrl in qa-selectors.ts/packet-selectors.ts, envelopePrintRows
 * in packet-selectors.ts) - app/crm/CrmApp.tsx passes the real one.
 *
 * A real, deliberately-preserved quirk from legacy's own renderPrint():
 * if the currently-selected stock filter no longer matches any of the
 * computed envelope groups (the underlying data changed since it was
 * picked), legacy silently resets state.printStockFilter back to "all"
 * AS A SIDE EFFECT of rendering, then uses the corrected value for that
 * same render's own row filtering. computePrintData() can't mutate state
 * (it's a pure function, like every other selector in this migration) -
 * it returns effectivePrintStockFilter instead (the value legacy's own
 * self-correction would have produced) and app/crm/CrmApp.tsx's
 * REACT_VIEWS.print entry writes it back to state.printStockFilter when
 * it differs, replicating the mutation without hiding it inside a
 * selector.
 */

import type { Dataset, DatasetMailing } from "@/lib/domain/dataset";
import { activeExceptions, componentStatus, effectiveMailings, includesText, selectedBatchDate, type EffectiveMailing } from "@/lib/client/selectors";
import { printModeForPlan, envelopeQuantityForMailing } from "@/lib/domain/plans";
import { driveCharacterKey, envelopeStockForCharacter, letterNumberKey } from "@/lib/domain/characters";
import { storageBinForMailing } from "@/lib/domain/batch-dates";

export interface DriveConfig {
  printReadyFolderUrl: string;
  characterFolders: Record<string, string>;
  envelopeFolders: Record<string, string>;
  letterFolders: Record<string, Record<string, string>>;
}

function characterFolderUrl(mailing: DatasetMailing, driveConfig: DriveConfig): string {
  return driveConfig.characterFolders[driveCharacterKey(mailing.character)] || "";
}

function envelopeFolderUrl(mailing: DatasetMailing, driveConfig: DriveConfig): string {
  return driveConfig.envelopeFolders[driveCharacterKey(mailing.character)] || "";
}

// Duplicated here rather than imported - the same one-line-ternary
// treatment printedEnvelopeStatusForMailing() got in Subscribers/QA/
// Packet, and letterFolderUrl() itself is a real export elsewhere
// (app/crm/legacy-app.js, for QA/Packet's own use), but this local
// wrapper's exact-vs-fallback-vs-missing three-way branch is print-row
// specific.
function letterFolderUrl(mailing: DatasetMailing, driveConfig: DriveConfig): string {
  const characterKey = driveCharacterKey(mailing.character);
  const letterKey = letterNumberKey(mailing.letterNumber);
  return driveConfig.letterFolders[characterKey]?.[letterKey] || "";
}

export interface PrintRowData {
  mailing: EffectiveMailing;
  mode: string;
  envelopeUrl: string;
  envelopeState: string;
  letterUrl: string;
  letterState: string;
  letterButtonLabel: string;
  notes: string;
  envelopeStock: string;
  envelopeQuantity: number;
  bin: string;
  fieldValues: { status: string; envelope: string };
}

function buildPrintRow(mailing: EffectiveMailing, seed: Dataset, reviewed: Set<string>, componentOverrides: Record<string, string>, driveConfig: DriveConfig): PrintRowData {
  const mode = printModeForPlan(mailing.plan);
  const exactLetterUrl = letterFolderUrl(mailing, driveConfig);
  const fallbackCharacterUrl = characterFolderUrl(mailing, driveConfig);
  const envelopeUrl = envelopeFolderUrl(mailing, driveConfig);
  const letterUrl = exactLetterUrl || fallbackCharacterUrl;
  const envelopeState = envelopeUrl ? "Character envelope folder" : "Needs envelope link";
  const letterState = exactLetterUrl ? `Exact Letter ${mailing.letterNumber}` : fallbackCharacterUrl ? "Open character folder" : "Needs letter link";
  const letterButtonLabel = exactLetterUrl ? "Open Letter" : fallbackCharacterUrl ? "Open Character" : "Needs Link";
  const notes = mode === "Prepaid bulk" ? "Can be printed/prepared in advance and stored by mail date." : "Time-sensitive renewal; generate only after paid order sync.";

  return {
    mailing,
    mode,
    envelopeUrl,
    envelopeState,
    letterUrl,
    letterState,
    letterButtonLabel,
    notes,
    envelopeStock: envelopeStockForCharacter(mailing.character),
    envelopeQuantity: envelopeQuantityForMailing(mailing),
    bin: storageBinForMailing(mailing),
    fieldValues: {
      status: mailing.status,
      envelope: componentStatus(mailing, "envelope", seed, reviewed, componentOverrides),
    },
  };
}

export interface EnvelopeGroup {
  label: string;
  count: number;
}

export interface PrintData {
  batchDate: string;
  rows: PrintRowData[];
  baseRows: EffectiveMailing[];
  envelopeGroups: EnvelopeGroup[];
  allStocksTotal: number;
  effectivePrintStockFilter: string;
  stockLabel: string;
  monthToMonthCount: number;
  latestMonthlyOrderDate: string;
  envelopePieceCount: number;
}

export function computePrintData(
  seed: Dataset,
  statusOverrides: Record<string, string>,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  batchFilter: string,
  printScope: string,
  printStockFilter: string,
  query: string,
  today: string,
  driveConfig: DriveConfig,
): PrintData {
  const highExceptionMailingIds = new Set(
    activeExceptions(seed, reviewed)
      .filter((item) => item.severity === "High")
      .map((item) => item.mailingId),
  );
  const mailings = effectiveMailings(seed, statusOverrides);
  const batchDate = selectedBatchDate(batchFilter, mailings, today);
  const baseRows = mailings
    .filter((mailing) => mailing.activeState === "Active")
    .filter((mailing) => !highExceptionMailingIds.has(mailing.mailingId))
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== "Mailed")
    .filter((mailing) => componentStatus(mailing, "envelope", seed, reviewed, componentOverrides) === "Need Print")
    .filter((mailing) => (printScope === "monthly" ? mailing.plan === "Month-to-month" : true))
    .filter((mailing) =>
      includesText([mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId], query),
    )
    .sort(
      (a, b) =>
        envelopeStockForCharacter(a.character).localeCompare(envelopeStockForCharacter(b.character)) ||
        driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character)) ||
        String(a.recipientName).localeCompare(String(b.recipientName)),
    );

  const groupTotals = new Map<string, number>();
  for (const mailing of baseRows) {
    const key = envelopeStockForCharacter(mailing.character);
    groupTotals.set(key, (groupTotals.get(key) || 0) + envelopeQuantityForMailing(mailing));
  }
  const envelopeGroups: EnvelopeGroup[] = Array.from(groupTotals.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const effectivePrintStockFilter = printStockFilter !== "all" && !envelopeGroups.some((group) => group.label === printStockFilter) ? "all" : printStockFilter;

  const filteredRows = baseRows.filter((mailing) => effectivePrintStockFilter === "all" || envelopeStockForCharacter(mailing.character) === effectivePrintStockFilter).slice(0, 160);

  const monthToMonthCount = filteredRows.filter((mailing) => printModeForPlan(mailing.plan) === "Month-to-month").length;
  const stockLabel = effectivePrintStockFilter === "all" ? "shown" : effectivePrintStockFilter.replace(" envelope", "");
  const latestMonthlyOrderDate =
    filteredRows
      .filter((mailing) => mailing.plan === "Month-to-month" && mailing.orderDate)
      .map((mailing) => mailing.orderDate)
      .sort()
      .at(-1) || "";
  const envelopePieceCount = filteredRows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);
  const allStocksTotal = baseRows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);

  return {
    batchDate,
    rows: filteredRows.map((mailing) => buildPrintRow(mailing, seed, reviewed, componentOverrides, driveConfig)),
    baseRows,
    envelopeGroups,
    allStocksTotal,
    effectivePrintStockFilter,
    stockLabel,
    monthToMonthCount,
    latestMonthlyOrderDate,
    envelopePieceCount,
  };
}
