/**
 * Mailing QA's own derivation, migrated from app/crm/legacy-app.js's
 * renderQa()/qaRow()/qaSelect() (Phase 1 step 14 - CLAUDE.md), the ninth
 * view migrated and the densest write surface in the app: seven
 * component-status fields per row, each independently editable.
 *
 * computeQaData() reuses every cross-view selector this filter/derivation
 * chain already had shared, tested implementations for -
 * activeExceptions()/effectiveMailings()/exceptionsForMailing()/
 * includesText()/selectedBatchDate() (lib/client/selectors.ts, shared with
 * every other view that needs them) and, new as of this step,
 * componentStatus()/qaIsReady()/qaNeedsAttention() (same module - moved
 * there rather than kept here, since Batch Packet's still-legacy
 * packetFinalRow() needs the exact same ready/attention classification -
 * see that file's own header for why this is a shared selector and
 * qaRows() itself isn't).
 *
 * QA_FIELDS (payment/envelope/letter/artifact/insert/location/qa - key,
 * label, and valid options for each) moved here unchanged from legacy's
 * qaFields, replacing that array's only remaining use once renderQa() was
 * deleted. tests/component-fields-parity.test.mjs now imports QA_FIELDS
 * directly from here instead of through the legacy-app.js sandbox.
 *
 * Row-level output is deliberately pre-computed and enriched, not left as
 * a bare EffectiveMailing[] the component would need seed/reviewed/
 * componentOverrides to re-derive from - same shape Subscribers' step 12
 * ProfileMailingRow used. Each QaRowData carries every one of the seven
 * fields' CURRENT status value (fieldValues), its ready/attention
 * classification, and its already-computed flag list, so Qa.tsx stays a
 * pure props-in/JSX-out component like every other migrated view.
 *
 * letterFolderUrl is threaded in as an explicit function parameter rather
 * than imported here - it's Drive-config lookup that lives in
 * app/crm/legacy-app.js (exported unchanged, a shared dependency this view
 * calls rather than owns - see that export's own comment), and importing
 * app/crm/legacy-app.js's module directly from a lib-shaped selectors file
 * would pull in that module's own side-effecting top-level setup for no
 * reason. app/crm/CrmApp.tsx passes the real one; tests pass a stub.
 */

import type { Dataset, DatasetException, DatasetMailing } from "@/lib/domain/dataset";
import {
  activeExceptions,
  componentStatus,
  effectiveMailings,
  exceptionsForMailing,
  includesText,
  qaIsReady,
  qaNeedsAttention,
  selectedBatchDate,
  type EffectiveMailing,
} from "@/lib/client/selectors";
import { envelopeQuantityForMailing } from "@/lib/domain/plans";
import { driveCharacterKey, envelopeStockForCharacter } from "@/lib/domain/characters";

export interface QaField {
  key: string;
  label: string;
  options: string[];
}

export const QA_FIELDS: QaField[] = [
  { key: "payment", label: "Payment", options: ["Active", "Needs Check", "CC Failed", "Paused"] },
  { key: "envelope", label: "Envelope", options: ["Need Print", "Printed", "Both Printed", "In Ashley Box", "Not Needed"] },
  { key: "letter", label: "Letter", options: ["Need Print", "Printed", "Stuffed", "Not Needed"] },
  { key: "artifact", label: "Artifact", options: ["Need Check", "Packed", "Not Needed"] },
  { key: "insert", label: "Map / Insert", options: ["Need Check", "Packed", "Not Needed"] },
  { key: "location", label: "Location", options: ["Marcy", "Ashley", "Batch Bin", "Mailed"] },
  { key: "qa", label: "QA", options: ["Open", "Problem", "Ready"] },
];

// Same one-line rule as legacy's own printedEnvelopeStatusForMailing()
// (app/crm/legacy-app.js, still used there by Batch Print's own bulk
// action, so left in place rather than deleted) and Subscribers'
// (app/crm/views/subscribers/subscribers-selectors.ts) - duplicated here
// for the same reason Subscribers' own copy gave: a trivial ternary over
// an already-shared selector (envelopeQuantityForMailing), not real logic
// worth threading an extra export through for. Now three copies - flagged
// in this step's PR as worth a real dedup pass, not fixed here since that
// would touch Subscribers, out of this task's explicit scope.
export function printedEnvelopeStatusForMailing(mailing: { envelopeQuantity: number }): string {
  return mailing.envelopeQuantity > 1 ? "Both Printed" : "Printed";
}

export interface QaFlag {
  text: string;
  tone: "rose" | "amber" | "blue" | "green";
}

export interface QaRowData {
  mailing: EffectiveMailing;
  envelopeQuantity: number;
  envelopeStock: string;
  isReady: boolean;
  needsAttention: boolean;
  fieldValues: Record<string, string>;
  flags: QaFlag[];
}

export interface QaData {
  rows: QaRowData[];
  batchDate: string;
  readyCount: number;
  envelopePrintCount: number;
  needsCheckCount: number;
  problemCount: number;
}

function buildFlags(mailing: EffectiveMailing, issues: DatasetException[], hasLetterFolder: boolean): QaFlag[] {
  const flags: QaFlag[] = issues.map((item) => ({ text: item.reason, tone: item.severity === "High" ? "rose" : "amber" }));
  if (!hasLetterFolder) flags.push({ text: "Letter folder not mapped", tone: "amber" });
  flags.push(mailing.plan === "Month-to-month" ? { text: "Month-to-month", tone: "blue" } : { text: "Prebuilt", tone: "green" });
  return flags;
}

export function computeQaData(
  seed: Dataset,
  statusOverrides: Record<string, string>,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  batchFilter: string,
  printScope: string,
  query: string,
  today: string,
  letterFolderUrl: (mailing: DatasetMailing) => string,
): QaData {
  const highExceptionMailingIds = new Set(
    activeExceptions(seed, reviewed)
      .filter((item) => item.severity === "High")
      .map((item) => item.mailingId),
  );
  const mailings = effectiveMailings(seed, statusOverrides);
  const batchDate = selectedBatchDate(batchFilter, mailings, today);
  const filteredRows = mailings
    .filter((mailing) => mailing.activeState === "Active")
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== "Mailed")
    .filter((mailing) => (printScope === "monthly" ? mailing.plan === "Month-to-month" : true))
    .filter((mailing) =>
      includesText([mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId], query),
    )
    .sort(
      (a, b) =>
        Number(highExceptionMailingIds.has(b.mailingId)) - Number(highExceptionMailingIds.has(a.mailingId)) ||
        envelopeStockForCharacter(a.character).localeCompare(envelopeStockForCharacter(b.character)) ||
        driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character)) ||
        String(a.recipientName).localeCompare(String(b.recipientName)),
    )
    .slice(0, 180);

  const rows: QaRowData[] = filteredRows.map((mailing) => {
    const fieldValues = Object.fromEntries(QA_FIELDS.map((field) => [field.key, componentStatus(mailing, field.key, seed, reviewed, componentOverrides)]));
    const issues = exceptionsForMailing(mailing, seed, reviewed);
    return {
      mailing,
      envelopeQuantity: envelopeQuantityForMailing(mailing),
      envelopeStock: envelopeStockForCharacter(mailing.character),
      isReady: qaIsReady(mailing, seed, reviewed, componentOverrides),
      needsAttention: qaNeedsAttention(mailing, seed, reviewed, componentOverrides),
      fieldValues,
      flags: buildFlags(mailing, issues, Boolean(letterFolderUrl(mailing))),
    };
  });

  const readyCount = rows.filter((row) => row.isReady).length;
  const problemCount = rows.filter((row) => row.fieldValues.qa === "Problem" || row.fieldValues.payment !== "Active").length;
  const envelopePrintCount = rows.filter((row) => row.fieldValues.envelope === "Need Print").reduce((total, row) => total + row.envelopeQuantity, 0);
  const needsCheckCount = rows.filter((row) => row.needsAttention).length;

  return { rows, batchDate, readyCount, envelopePrintCount, needsCheckCount, problemCount };
}
