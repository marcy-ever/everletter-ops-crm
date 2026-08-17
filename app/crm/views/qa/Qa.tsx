// Phase 1, step 14 of the app.js decomposition (CLAUDE.md) - the ninth
// view migrated out of app/crm/legacy-app.js, and the densest write
// surface in the app: seven independently-editable component-status
// selects per row, across up to 180 rows, plus two batch actions and a
// scope toggle shared with Batch Print's own still-legacy view (see
// onScopeChange's own comment below for why that sharing matters).
//
// Input-handling shape: props with callbacks, same as every interactive
// view since step 8. onFieldChange receives the row's full mailing object
// plus the field key and new value - not a "rowKey::field::x" string to
// parse and re-look-up, the same simplification every migrated view's
// callbacks have made over their legacy querySelector-based originals.
//
// The two batch actions are migrated exactly as they are - no
// confirmation dialog, no restyling, no batching, no undo - same rule
// step 13's (Production Queue) bulk buttons were migrated under. Decision
// rights over whether to guard them stay Marcy's, not this branch's.

import { formatDate } from "@/lib/domain/format";
import { mailingKey } from "@/lib/domain/keys";
import { number, statusClass } from "../../format";
import { QA_FIELDS } from "./qa-selectors";
import type { QaData, QaRowData } from "./qa-selectors";

export interface QaProps {
  data: QaData;
  printScope: string;
  onScopeChange: (scope: string) => void;
  onFieldChange: (mailing: QaRowData["mailing"], field: string, value: string) => void;
  onMarkReady: () => void;
  onMarkMailed: () => void;
}

export default function Qa({ data, printScope, onScopeChange, onFieldChange, onMarkReady, onMarkMailed }: QaProps) {
  const { rows, batchDate, readyCount, envelopePrintCount, needsCheckCount, problemCount } = data;
  return (
    <section className="data-panel" aria-label="Mailing QA">
      <div className="panel-head">
        <div>
          <h3>{batchDate ? `${formatDate(batchDate)} Mailing QA` : "Mailing QA"}</h3>
          <p>One truth for mailing day: payment, envelope, letter, artifact, insert, physical location, and final ready state.</p>
        </div>
        <span className="panel-count">{rows.length} items</span>
      </div>

      <div className="print-summary qa-summary">
        <div>
          <span>Ready</span>
          <strong>{number(readyCount)}</strong>
        </div>
        <div>
          <span>Envelopes to print</span>
          <strong>{number(envelopePrintCount)}</strong>
        </div>
        <div>
          <span>Needs check</span>
          <strong>{number(needsCheckCount)}</strong>
        </div>
        <div>
          <span>Problems</span>
          <strong>{number(problemCount)}</strong>
        </div>
      </div>

      <div className="print-toolbar" aria-label="QA scope">
        <span>Show:</span>
        <button type="button" className={printScope === "monthly" ? "active" : ""} data-qa-scope="monthly" onClick={() => onScopeChange("monthly")}>
          Month-to-month only
        </button>
        <button type="button" className={printScope === "all" ? "active" : ""} data-qa-scope="all" onClick={() => onScopeChange("all")}>
          All open mailings
        </button>
      </div>

      <div className="batch-actions" aria-label="QA actions">
        <span>Batch actions:</span>
        <button type="button" data-qa-mark-ready="" onClick={onMarkReady}>
          Mark clean shown rows Ready
        </button>
        <button type="button" data-qa-mark-mailed="" onClick={onMarkMailed}>
          Mark QA-ready rows Mailed
        </button>
      </div>

      <div className="table-wrap">
        <table className="qa-table">
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Recipient</th>
              <th>Character</th>
              <th>Plan</th>
              <th>Letter</th>
              <th>Env Qty</th>
              {QA_FIELDS.map((field) => (
                <th key={field.key}>{field.label}</th>
              ))}
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => <QaRow row={row} onFieldChange={onFieldChange} key={mailingKey(row.mailing)} />)
            ) : (
              <tr>
                <td colSpan={14} className="empty-state">
                  Nothing in this QA batch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QaRow({ row, onFieldChange }: { row: QaRowData; onFieldChange: QaProps["onFieldChange"] }) {
  const { mailing } = row;
  const rowClass = row.isReady ? "qa-ready-row" : row.needsAttention ? "qa-attention-row" : "";
  return (
    <tr className={rowClass}>
      <td>{formatDate(mailing.shipDate)}</td>
      <td>
        <strong>{mailing.recipientName}</strong>
        <span>{mailing.email || "Missing email"}</span>
      </td>
      <td>
        {mailing.character}
        <span>{row.envelopeStock}</span>
      </td>
      <td>{mailing.plan}</td>
      <td>{mailing.letterNumber}</td>
      <td>
        <strong>{number(row.envelopeQuantity)}</strong>
      </td>
      {QA_FIELDS.map((field) => {
        const value = row.fieldValues[field.key];
        return (
          <td key={field.key}>
            <select
              className={`qa-select qa-${statusClass(value)}`}
              data-qa-select={`${mailingKey(mailing)}::field::${field.key}`}
              value={value}
              onChange={(event) => onFieldChange(mailing, field.key, event.target.value)}
            >
              {field.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </td>
        );
      })}
      <td>
        <div className="flag-stack">
          {row.flags.map((flag, index) => (
            <span className={`flag flag-${flag.tone}`} key={`${flag.tone}-${index}`}>
              {flag.text}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}
