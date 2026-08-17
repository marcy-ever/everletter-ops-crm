// Phase 1, step 17 of the app.js decomposition (CLAUDE.md) - the last of
// twelve views migrated out of app/crm/legacy-app.js. The generator this
// view calls (envelopeHtml() et al., ./envelope-html.ts) does NOT become
// React - see that module's own header for why. This component is
// everything else: two filters, per-row status/envelope-status writes, a
// per-row single-envelope print, and four bulk/browser actions.
//
// Input-handling shape: props with callbacks, same as every interactive
// view since step 8. onFieldChange covers both per-row selects (status
// and envelope status) - the same shared shape Queue/QA/Bins/Packet use,
// distinguished by the `field` argument ("status" routes to
// updateMailingStatus, "envelope" to updateEnvelopeStatus - see
// CrmApp.tsx's REACT_VIEWS.print entry for exactly which).
//
// The bulk/browser actions are migrated exactly as they are: no
// confirmation, no restyling, no batching, no undo - same rule steps
// 13-16's bulk buttons were migrated under.

import { formatDate } from "@/lib/domain/format";
import { mailingKey } from "@/lib/domain/keys";
import { MAILING_STATUSES } from "@/lib/domain/mailing-rules";
import { COMPONENT_FIELD_OPTIONS } from "@/lib/domain/component-fields";
import { number, statusClass } from "../../format";
import type { EffectiveMailing } from "@/lib/client/selectors";
import type { PrintData, PrintRowData } from "./print-selectors";

export interface PrintProps {
  data: PrintData;
  printScope: string;
  printStockFilter: string;
  printReadyFolderUrl: string;
  onScopeChange: (scope: string) => void;
  onStockChange: (stock: string) => void;
  onFieldChange: (mailing: EffectiveMailing, field: "status" | "envelope", value: string) => void;
  onBrowserPrint: () => void;
  onPrintEnvelopes: () => void;
  onPrintOneEnvelope: (mailing: EffectiveMailing) => void;
  onMarkEnvelopesPrinted: () => void;
  onOpenDriveLink: (url: string) => void;
  onPrintAction: () => void;
}

export default function Print({
  data,
  printScope,
  printStockFilter,
  printReadyFolderUrl,
  onScopeChange,
  onStockChange,
  onFieldChange,
  onBrowserPrint,
  onPrintEnvelopes,
  onPrintOneEnvelope,
  onMarkEnvelopesPrinted,
  onOpenDriveLink,
  onPrintAction,
}: PrintProps) {
  const { batchDate, rows, envelopeGroups, allStocksTotal, stockLabel, monthToMonthCount, latestMonthlyOrderDate, envelopePieceCount } = data;

  return (
    <section className="data-panel" aria-label="Batch print">
      <div className="panel-head">
        <div>
          <h3>{batchDate ? `${formatDate(batchDate)} Batch Print` : "Batch Print"}</h3>
          <p>Shows envelopes still marked Need Print. Once a customer envelope is marked Printed or In Ashley Box, it drops off this print list.</p>
        </div>
        <span className="panel-count">
          {rows.length} shown / {number(envelopePieceCount)} envelopes
        </span>
      </div>

      <div className="print-summary">
        <div>
          <span>Mailing rows</span>
          <strong>{number(rows.length)}</strong>
        </div>
        <div>
          <span>Envelopes to print</span>
          <strong>{number(envelopePieceCount)}</strong>
        </div>
        <div>
          <span>Month-to-month</span>
          <strong>{number(monthToMonthCount)}</strong>
        </div>
        <div>
          <span>Latest renewal</span>
          <strong>{latestMonthlyOrderDate ? formatDate(latestMonthlyOrderDate) : "None"}</strong>
        </div>
      </div>

      <div className="print-toolbar" aria-label="Print scope">
        <span>Show:</span>
        <button type="button" className={printScope === "monthly" ? "active" : ""} data-print-scope="monthly" onClick={() => onScopeChange("monthly")}>
          Month-to-month only
        </button>
        <button type="button" className={printScope === "all" ? "active" : ""} data-print-scope="all" onClick={() => onScopeChange("all")}>
          All open mailings
        </button>
      </div>

      <div className="envelope-groups" aria-label="Envelope groups">
        <button type="button" className={printStockFilter === "all" ? "active" : ""} data-print-stock="all" onClick={() => onStockChange("all")}>
          All stocks <strong>{number(allStocksTotal)}</strong>
        </button>
        {envelopeGroups.map((group) => (
          <button type="button" className={printStockFilter === group.label ? "active" : ""} data-print-stock={group.label} onClick={() => onStockChange(group.label)} key={group.label}>
            {group.label} <strong>{number(group.count)}</strong>
          </button>
        ))}
      </div>

      <div className="batch-actions" aria-label="Print actions">
        <span>Print actions:</span>
        <button type="button" data-browser-print="" onClick={onBrowserPrint}>
          Print This List
        </button>
        <button type="button" data-print-envelopes="" onClick={onPrintEnvelopes}>
          Print {stockLabel} Envelopes ({number(envelopePieceCount)})
        </button>
        <button type="button" data-mark-envelopes-printed="" onClick={onMarkEnvelopesPrinted}>
          Mark {stockLabel} Envelopes Printed
        </button>
        <button type="button" data-drive-url={printReadyFolderUrl} onClick={() => onOpenDriveLink(printReadyFolderUrl)}>
          Open Print-Ready Folder
        </button>
        <button type="button" data-print-action="batch-envelope" onClick={onPrintAction}>
          Open Batch Envelopes
        </button>
        <button type="button" data-print-action="batch-letter" onClick={onPrintAction}>
          Open Batch Letters
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Recipient</th>
              <th>Mode</th>
              <th>Renewal Date</th>
              <th>Status</th>
              <th>Envelope Status</th>
              <th>Storage Bin</th>
              <th>Envelope Stock</th>
              <th>Env Qty</th>
              <th>Envelope</th>
              <th>Letter</th>
              <th>Print Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PrintTableRow
                row={row}
                onFieldChange={onFieldChange}
                onPrintOneEnvelope={onPrintOneEnvelope}
                onOpenDriveLink={onOpenDriveLink}
                onPrintAction={onPrintAction}
                key={mailingKey(row.mailing)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DriveButton({ label, url, fallbackAction, onOpenDriveLink, onPrintAction }: { label: string; url: string; fallbackAction: string; onOpenDriveLink: PrintProps["onOpenDriveLink"]; onPrintAction: PrintProps["onPrintAction"] }) {
  if (url) {
    return (
      <button type="button" className="link-button" data-drive-url={url} onClick={() => onOpenDriveLink(url)}>
        {label}
      </button>
    );
  }
  return (
    <button type="button" className="link-button" data-print-action={fallbackAction} onClick={onPrintAction}>
      {label}
    </button>
  );
}

function PrintTableRow({
  row,
  onFieldChange,
  onPrintOneEnvelope,
  onOpenDriveLink,
  onPrintAction,
}: {
  row: PrintRowData;
  onFieldChange: PrintProps["onFieldChange"];
  onPrintOneEnvelope: PrintProps["onPrintOneEnvelope"];
  onOpenDriveLink: PrintProps["onOpenDriveLink"];
  onPrintAction: PrintProps["onPrintAction"];
}) {
  const { mailing, mode, envelopeUrl, envelopeState, letterUrl, letterState, letterButtonLabel, notes, envelopeStock, envelopeQuantity, bin, fieldValues } = row;
  return (
    <tr>
      <td>{formatDate(mailing.shipDate)}</td>
      <td>
        <strong>{mailing.recipientName}</strong>
        <span>{mailing.email || "Missing email"}</span>
      </td>
      <td>
        <span className={`flag ${mode === "Prepaid bulk" ? "flag-green" : "flag-amber"}`}>{mode}</span>
      </td>
      <td>
        {mailing.plan === "Month-to-month" ? (
          <>
            <strong>{formatDate(mailing.orderDate)}</strong>
            <span>Paid/order date</span>
          </>
        ) : (
          <span>{formatDate(mailing.orderDate)}</span>
        )}
      </td>
      <td>
        <select
          className={`status-select status-${statusClass(fieldValues.status)}`}
          data-print-status={mailingKey(mailing)}
          value={fieldValues.status}
          onChange={(event) => onFieldChange(mailing, "status", event.target.value)}
        >
          {MAILING_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </td>
      <td>
        <select
          className={`qa-select qa-${statusClass(fieldValues.envelope)}`}
          data-print-envelope-status={mailingKey(mailing)}
          value={fieldValues.envelope}
          onChange={(event) => onFieldChange(mailing, "envelope", event.target.value)}
        >
          {COMPONENT_FIELD_OPTIONS.envelope.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </td>
      <td>{bin}</td>
      <td>{envelopeStock}</td>
      <td>
        <strong>{number(envelopeQuantity)}</strong>
        <span>{mailing.plan === "Month-to-month" ? "This paid month" : "Per mailing"}</span>
      </td>
      <td>
        <button type="button" className="link-button" data-print-one-envelope={mailingKey(mailing)} onClick={() => onPrintOneEnvelope(mailing)}>
          Print Envelope
        </button>
        <DriveButton label="Open Folder" url={envelopeUrl} fallbackAction="envelope" onOpenDriveLink={onOpenDriveLink} onPrintAction={onPrintAction} />
        <span>{envelopeState}</span>
      </td>
      <td>
        <DriveButton label={letterButtonLabel} url={letterUrl} fallbackAction="letter" onOpenDriveLink={onOpenDriveLink} onPrintAction={onPrintAction} />
        <span>{letterState}</span>
      </td>
      <td>{notes}</td>
    </tr>
  );
}
