// Phase 1, step 16 of the app.js decomposition (CLAUDE.md) - the
// eleventh view migrated out of app/crm/legacy-app.js. Desktop-only, on
// purpose: no mobile card list here, unlike its own naming would suggest
// (that markup lives in Batch Packet - see step 15's own PR and
// app/crm/views/bins/bins-selectors.ts's header for the real,
// pre-existing oddity, established in step 1).
//
// Input-handling shape: props with callbacks, same as every interactive
// view since step 8. onFieldChange is the REFERENCE implementation this
// migration's whole [data-bin-select] mechanism is built on - Batch
// Packet's own mobile cards (left inert in step 15) get wired to this
// same callback in this step's second, separate commit. Every real write
// site anywhere in the app for this attribute now shares this one
// definition.
//
// The bulk buttons ([data-bin-mark="ready"/"check"]) are migrated exactly
// as they are: no confirmation, no restyling, no batching, no undo - same
// rule steps 13-15's bulk buttons were migrated under, and the second of
// the two sets Marcy owns the decision on (the first was Production
// Queue's/Batch Print's bulk-status buttons).

import { formatDate } from "@/lib/domain/format";
import { mailingKey } from "@/lib/domain/keys";
import { COMPONENT_FIELD_OPTIONS } from "@/lib/domain/component-fields";
import { number, statusClass } from "../../format";
import type { EffectiveMailing } from "@/lib/client/selectors";
import type { BinGroup, BinRowData, BinsData } from "./bins-selectors";

export interface BinsProps {
  data: BinsData;
  onFieldChange: (mailing: EffectiveMailing, field: string, value: string) => void;
  onBulkMark: (mode: "ready" | "check") => void;
  onPrint: () => void;
}

export default function Bins({ data, onFieldChange, onBulkMark, onPrint }: BinsProps) {
  const { batchDate, rows, groups, readyCount, needsCheckCount, missingEnvelopeCount, missingLetterCount } = data;

  return (
    <section className="data-panel bins-panel" aria-label="Ashley bins">
      <div className="panel-head">
        <div>
          <h3>{batchDate ? `${formatDate(batchDate)} Ashley Bins` : "Ashley Bins"}</h3>
          <p>Physical inventory for prepaid 6- and 12-month mailings that should already be stuffed, labeled, and stored by batch date.</p>
        </div>
        <span className="panel-count">{number(rows.length)} bin rows</span>
      </div>

      <div className="print-summary bin-summary">
        <div>
          <span>Prebuilt rows</span>
          <strong>{number(rows.length)}</strong>
        </div>
        <div>
          <span>Ready in bins</span>
          <strong>{number(readyCount)}</strong>
        </div>
        <div>
          <span>Needs bin check</span>
          <strong>{number(needsCheckCount)}</strong>
        </div>
        <div>
          <span>Missing env / letter</span>
          <strong>
            {number(missingEnvelopeCount)} / {number(missingLetterCount)}
          </strong>
        </div>
      </div>

      <div className="batch-actions" aria-label="Bin actions">
        <span>Update shown rows:</span>
        <button type="button" data-bin-mark="ready" onClick={() => onBulkMark("ready")}>
          Mark In Ashley Box + Stuffed
        </button>
        <button type="button" data-bin-mark="check" onClick={() => onBulkMark("check")}>
          Mark Needs Bin Check
        </button>
        <button type="button" data-bin-print="" onClick={onPrint}>
          Print Bin Checklist
        </button>
      </div>

      <div className="packet-grid bin-group-grid">
        {groups.length ? (
          groups.map((group) => <BinGroupCard group={group} key={group.label} />)
        ) : (
          <article className="packet-card">
            <h4>No prepaid rows</h4>
            <p>Nothing is expected in Ashley bins for this batch.</p>
          </article>
        )}
      </div>

      <div className="packet-section">
        <div className="panel-head packet-section-head">
          <div>
            <h3>Bin Row Checklist</h3>
            <p>Use this to verify each prebuilt piece is physically in the right dated bin.</p>
          </div>
          <span className="panel-count">{number(rows.length)} rows</span>
        </div>
        <div className="table-wrap">
          <table className="packet-table">
            <thead>
              <tr>
                <th>Ship Date</th>
                <th>Recipient</th>
                <th>Character</th>
                <th>Letter</th>
                <th>Bin Status</th>
                <th>Envelope</th>
                <th>Letter Status</th>
                <th>Location</th>
                <th>Bin</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => <BinTableRow row={row} onFieldChange={onFieldChange} key={mailingKey(row.mailing)} />)
              ) : (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No Ashley bin rows for this batch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function BinGroupCard({ group }: { group: BinGroup }) {
  return (
    <article className="packet-card bin-card">
      <h4>{group.label}</h4>
      <p>{number(group.total)} pieces expected in this dated bin group.</p>
      <div className="bin-card-counts">
        <div>
          <span>Confirmed</span>
          <strong>{number(group.ready)}</strong>
        </div>
        <div>
          <span>Check</span>
          <strong>{number(group.needsCheck)}</strong>
        </div>
      </div>
    </article>
  );
}

function BinTableRow({ row, onFieldChange }: { row: BinRowData; onFieldChange: BinsProps["onFieldChange"] }) {
  const { mailing, status, bin, fieldValues } = row;
  return (
    <tr>
      <td>{formatDate(mailing.shipDate)}</td>
      <td>
        <strong>{mailing.recipientName}</strong>
        <span>{mailing.plan}</span>
      </td>
      <td>{mailing.character}</td>
      <td>{mailing.letterNumber}</td>
      <td>
        <span className={`pill status-${statusClass(status.label)}`}>{status.label}</span>
        <span>{status.detail}</span>
      </td>
      <td>
        <select
          className={`qa-select qa-${statusClass(fieldValues.envelope)}`}
          data-bin-select={`${mailingKey(mailing)}::field::envelope`}
          value={fieldValues.envelope}
          onChange={(event) => onFieldChange(mailing, "envelope", event.target.value)}
        >
          {COMPONENT_FIELD_OPTIONS.envelope.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </td>
      <td>
        <select
          className={`qa-select qa-${statusClass(fieldValues.letter)}`}
          data-bin-select={`${mailingKey(mailing)}::field::letter`}
          value={fieldValues.letter}
          onChange={(event) => onFieldChange(mailing, "letter", event.target.value)}
        >
          {COMPONENT_FIELD_OPTIONS.letter.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </td>
      <td>
        <select
          className={`qa-select qa-${statusClass(fieldValues.location)}`}
          data-bin-select={`${mailingKey(mailing)}::field::location`}
          value={fieldValues.location}
          onChange={(event) => onFieldChange(mailing, "location", event.target.value)}
        >
          {COMPONENT_FIELD_OPTIONS.location.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </td>
      <td>{bin}</td>
    </tr>
  );
}
