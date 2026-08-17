// Phase 1, step 11 of the app.js decomposition (CLAUDE.md) - the sixth
// view migrated out of app/crm/legacy-app.js, and the first with a file
// input and an async, multi-stage flow (select -> preview -> publish).
//
// Input-handling shape: props with callbacks, same as every interactive
// view since step 8. `data` is computed by import-selectors.ts's
// computeImportData(); onFileSelect/onPublish are supplied by
// app/crm/CrmApp.tsx, the only place (besides legacy-app.js itself)
// allowed to touch `state` for a React-hosted view - their bodies mirror
// the removed legacy #spreadsheetUpload/#publishImport handlers exactly,
// including which of the two publish outcomes calls render() (a seed
// replacement affects the shell's metrics/topbar) versus which ones
// don't (reading a file preview, or a rejected publish, touch nothing
// outside this view) - see CrmApp.tsx's own comment for the full
// three-way split.
//
// This is the most destructive action in the app - publishing replaces
// the dataset (writeImport() deletes every row not in the payload). The
// existing failure reporting is unchanged: onPublish's promise rejecting
// (including the catastrophic-deletion guard's 409, whose message is the
// only safety net this path has - there's deliberately no UI for the
// server-side-only confirmLargeDelete override) surfaces through
// data.importStatus exactly as it did in renderImport().
//
// publishImport stays disabled while data.importBusy is true - the same,
// and only, guard legacy had against a second click firing mid-publish
// (no state-level guard existed in the removed handler either; this
// reproduces that exactly rather than adding a new one).

import { number } from "../../format";
import type { ImportData } from "./import-selectors";

export interface ImportProps {
  data: ImportData;
  onFileSelect: (file: File) => void;
  onPublish: () => void;
}

export default function Import({ data, onFileSelect, onPublish }: ImportProps) {
  const { preview } = data;
  return (
    <section className="data-panel import-panel" aria-label="Import spreadsheet">
      <div className="panel-head">
        <div>
          <h3>Import updated spreadsheet</h3>
          <p>Add new Squarespace orders to your current Everletter Mailing Schedule, then upload the .xlsx here. The CRM will rebuild mailings, exceptions, batches, subscribers, QA, and bins from it.</p>
        </div>
        <span className="panel-count">Launch-week bridge</span>
      </div>

      <div className="import-layout">
        <article className="import-card">
          <span className="sample-badge">Current CRM data</span>
          <dl className="sample-fields">
            <div>
              <dt>Source</dt>
              <dd>{data.activeSource}</dd>
            </div>
            <div>
              <dt>Shared upload</dt>
              <dd>{data.uploadedAt}</dd>
            </div>
            <div>
              <dt>Mailings</dt>
              <dd>{number(data.mailingCount)}</dd>
            </div>
            <div>
              <dt>Needs Review</dt>
              <dd>{number(data.needsReviewCount)}</dd>
            </div>
          </dl>
        </article>

        <article className="import-card import-uploader">
          <label className="file-drop">
            <span>Choose Everletter Mailing Schedule</span>
            <strong>.xlsx, .xls, or .csv</strong>
            <input
              id="spreadsheetUpload"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFileSelect(file);
              }}
            />
          </label>
          <p className="import-hint">Use the same columns you already have: Order ID, Original Order Date, Customer Name and Address, Character, Letter Number, Ship Date, Subscription, Status, Active?, Email.</p>
          {data.importStatus && <div className="import-status">{data.importStatus}</div>}
        </article>
      </div>

      {preview && (
        <div className="import-preview">
          <div className="panel-head">
            <div>
              <h3>Preview before publishing</h3>
              <p>
                {preview.fileName} - {preview.sheetName}
              </p>
            </div>
            <button type="button" id="publishImport" disabled={data.importBusy} onClick={onPublish}>
              {data.importBusy ? "Publishing..." : "Publish to shared CRM"}
            </button>
          </div>
          <div className="print-summary">
            <div>
              <span>Rows read</span>
              <strong>{number(preview.rowCount)}</strong>
            </div>
            <div>
              <span>Subscribers</span>
              <strong>{number(preview.seed.summary.subscriberCount)}</strong>
            </div>
            <div>
              <span>Mailings</span>
              <strong>{number(preview.seed.summary.mailingCount)}</strong>
            </div>
            <div>
              <span>Open</span>
              <strong>{number(preview.seed.summary.openMailingCount)}</strong>
            </div>
            <div>
              <span>Needs Review</span>
              <strong>{number(preview.seed.summary.exceptionCount)}</strong>
            </div>
          </div>
          <div className="import-checklist">
            <div>
              <strong>After publishing:</strong> Ashley will see this same imported data when she refreshes.
            </div>
            <div>Existing CRM status clicks are preserved when mailing keys still match the uploaded sheet.</div>
            <div>Bad dates, missing addresses, missing emails, or non-1st/15th mailings appear in Needs Review.</div>
          </div>
        </div>
      )}
    </section>
  );
}
