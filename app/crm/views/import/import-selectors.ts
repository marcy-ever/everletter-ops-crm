/**
 * Import Sheet's own file-handling helper, migrated from
 * app/crm/legacy-app.js's readWorkbookFile()/defaultAutomationRules()
 * (Phase 1 step 11 - CLAUDE.md). Browser-only (window.XLSX, File.
 * arrayBuffer()) - can't live in lib/domain/, which never touches the
 * DOM - so it stays beside its component like every other view-specific
 * module.
 *
 * Per this step's own instruction: the hard logic (parsing rows into
 * normalized fields, building the Dataset) already left this file in
 * Phase 0 and stays in lib/domain/spreadsheet/build-seed.ts, imported
 * here unchanged, not reimplemented. What actually moved is file
 * handling and result shaping - the same division of labor
 * readWorkbookFile already had, just with `now` and `automationRules`
 * threaded in explicitly (same pattern every other migrated view's
 * clock-touching logic uses) instead of reading `new Date()`/
 * `window.EVERLETTER_SEED`/`state.seed` internally. app/crm/CrmApp.tsx
 * computes both and passes them in - the one place already established
 * as where a migrated view's clock/state reads happen.
 */

import { buildSeedFromSpreadsheet } from "@/lib/domain/spreadsheet/build-seed";
import type { ImportPreview } from "@/lib/client/crm-state";
import type { SharedDatasetPayload } from "@/lib/client/shared-state-client";
import type { Dataset, DatasetImportSummary } from "@/lib/domain/dataset";
import { activeExceptions } from "@/lib/client/selectors";
import { formatDate } from "@/lib/domain/format";

// The narrow slice of SheetJS/XLSX's real API this function actually
// calls - not the library's full type surface, which this repo doesn't
// otherwise need (public/xlsx.full.min.js is loaded as a plain browser
// global, not an npm dependency with its own types).
interface XlsxGlobal {
  read(data: ArrayBuffer, options: { type: "array"; cellDates: boolean }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json(sheet: unknown, options: { defval: string; raw: boolean; blankrows: boolean }): Record<string, unknown>[];
  };
}

declare global {
  interface Window {
    XLSX?: XlsxGlobal;
    // The sanitized, committed empty-fallback dataset (public/everletterSeed.json)
    // loaded synchronously before the real one arrives - see CLAUDE.md's
    // data-boundary section. defaultAutomationRules() below preserves
    // legacy's exact precedence (this fallback first, then the real
    // seed) even though, by the time a user can reach this view at all,
    // state.seed is already populated and this first branch is
    // effectively unreachable - not a live risk, so not worth trimming
    // as a drive-by.
    EVERLETTER_SEED?: { automationRules?: unknown[] };
  }
}

export interface ImportData {
  activeSource: string;
  uploadedAt: string;
  mailingCount: number;
  needsReviewCount: number;
  importStatus: string;
  preview: ImportPreview | null;
  importBusy: boolean;
  // Set only once this session's own publish has actually returned a
  // server response - see computeImportData's own comment below for why
  // this can't be reconstructed from anything else state holds.
  importSummary: DatasetImportSummary | null;
}

// The display-only derivation renderImport() computed inline
// (activeSource/uploadedAt), plus the two counts it read from
// activeExceptions()/state.seed.summary directly. preview/importStatus/
// importBusy pass straight through - not derived, just gathered here so
// app/crm/CrmApp.tsx's REACT_VIEWS.import entry has one call instead of
// five separate `state.importXxx` reads.
//
// importSummary comes from importInfo.importSummary - the reconciliation
// (rows in the file, mailings written, what was skipped and which sheet
// rows) that lets someone act on an import instead of just trusting it
// worked. Deliberately session-scoped, not something GET /api/shared-state
// returns on a later page load: it describes what *this* publish did, not
// a durable property of the current dataset - a page refresh (or a
// different tab) correctly shows no reconciliation until that session
// publishes its own import, the same way importInfo itself already works
// for activeSource/uploadedAt above. The durable record of what a past
// import skipped lives in ingestion_events.skipped
// (db/schema/ingestion_events.ts), not here.
export function computeImportData(seed: Dataset, reviewed: Set<string>, importInfo: SharedDatasetPayload | null, importPreview: ImportPreview | null, importStatus: string, importBusy: boolean): ImportData {
  return {
    activeSource: importInfo?.sourceName || seed.summary.sourceFile || "Built-in starter data",
    uploadedAt: importInfo?.uploadedAt ? formatDate(importInfo.uploadedAt.slice(0, 10)) : "Not uploaded yet",
    mailingCount: seed.summary.mailingCount,
    needsReviewCount: activeExceptions(seed, reviewed).length,
    importStatus,
    preview: importPreview,
    importBusy,
    importSummary: importInfo?.importSummary ?? null,
  };
}

export function defaultAutomationRules(seed: Dataset | null): unknown[] {
  return window.EVERLETTER_SEED?.automationRules || seed?.automationRules || [];
}

export async function readWorkbookFile(file: File, now: Date, automationRules: unknown[]): Promise<ImportPreview> {
  if (!window.XLSX) throw new Error("The Excel parser did not load. Refresh the CRM and try again.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes("mailing")) || workbook.SheetNames[0];
  if (!sheetName) throw new Error("No worksheet found in that file.");
  // blankrows:true keeps fully-blank sheet rows in the array so sourceRow
  // (index+2 in buildSeedFromSpreadsheet) always lines up with the real
  // physical spreadsheet row; the content-based filter in
  // buildSeedFromSpreadsheet drops these blank rows afterward on its own.
  const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true, blankrows: true });
  if (!rows.length) throw new Error("That worksheet looks empty.");
  const seed = buildSeedFromSpreadsheet(rows, file.name, now, automationRules);
  if (!seed.mailings.length) throw new Error("I could not find any mailing rows in that sheet.");
  return { seed, sheetName, rowCount: rows.length, fileName: file.name };
}
