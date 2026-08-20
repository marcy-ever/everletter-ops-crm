// Phase 1, step 13 of the app.js decomposition (CLAUDE.md) - the eighth
// view migrated out of app/crm/legacy-app.js, and the busiest
// operational screen in the app: a per-row status write (the same write
// path as Needs Review's Reviewed button, step 10, just one per row
// across up to 120 rows) plus five bulk-action buttons that rewrite
// every currently-shown row in one click.
//
// Input-handling shape: props with callbacks, same as every interactive
// view since step 8. onStatusChange receives the full mailing row (not a
// key string to re-look-up via rows.find(mailingKey(mailing) === ...),
// the same simplification every migrated view's callbacks have made over
// their legacy querySelector-based originals).
//
// The bulk buttons are migrated exactly as they are - no confirmation
// dialog, no restyling, no batching, no undo. That's a deliberate
// decision with decision rights explicitly Marcy's, not an oversight
// this migration corrects. onBulkStatus's implementation
// (app/crm/CrmApp.tsx) reproduces rows.forEach(mailing =>
// updateMailingStatus(mailing, nextStatus)) exactly - a single click
// rewrites every shown row with no prompt, same as legacy.

import { formatDate } from "@/lib/domain/format";
import { mailingKey } from "@/lib/domain/keys";
import { MAILING_STATUSES } from "@/lib/domain/mailing-rules";
import { statusClass } from "../../format";
import type { EffectiveMailing } from "@/lib/client/selectors";
import type { QueueData } from "./queue-selectors";

export interface QueueProps {
  data: QueueData;
  onStatusChange: (mailing: EffectiveMailing, status: string) => void;
  onBulkStatus: (status: string) => void;
  onRecipientClick: (subscriberId: string) => void;
}

export default function Queue({ data, onStatusChange, onBulkStatus, onRecipientClick }: QueueProps) {
  const { rows, batchDate } = data;
  return (
    <section className="data-panel" aria-label="Production queue">
      <div className="panel-head">
        <div>
          <h3>{batchDate ? `${formatDate(batchDate)} Mail Batch` : "Production Queue"}</h3>
          <p>Active subscribers only. Use the batch filter to focus on the immediate 1st/15th mailing.</p>
        </div>
        <span className="panel-count">{rows.length} shown</span>
      </div>
      <div className="batch-actions" aria-label="Batch status actions">
        <span>Update shown rows:</span>
        {MAILING_STATUSES.map((status) => (
          <button type="button" data-bulk-status={status} onClick={() => onBulkStatus(status)} key={status}>
            {status}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Status</th>
              <th>Recipient</th>
              <th>Character</th>
              <th>Plan</th>
              <th>Letter</th>
              <th>Billing Order</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((mailing) => (
              <QueueRow mailing={mailing} onStatusChange={onStatusChange} onRecipientClick={onRecipientClick} key={mailingKey(mailing)} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QueueRow({ mailing, onStatusChange, onRecipientClick }: { mailing: EffectiveMailing; onStatusChange: QueueProps["onStatusChange"]; onRecipientClick: QueueProps["onRecipientClick"] }) {
  return (
    <tr>
      <td>{formatDate(mailing.shipDate)}</td>
      <td>
        <select
          className={`status-select status-${statusClass(mailing.status)}`}
          data-status-select={mailingKey(mailing)}
          value={mailing.status}
          onChange={(event) => onStatusChange(mailing, event.target.value)}
        >
          {MAILING_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </td>
      <td>
        <button type="button" className="link-button recipient-profile-link" onClick={() => onRecipientClick(mailing.subscriberId)}>
          {mailing.recipientName}
        </button>
        <span>{mailing.email || "Missing email"}</span>
      </td>
      <td>{mailing.character}</td>
      <td>{mailing.plan}</td>
      <td>{mailing.letterNumber}</td>
      <td className="mono">{mailing.orderId}</td>
      <td>
        <div className="flag-stack">
          {mailing.overdue && <span className="flag flag-rose">Overdue</span>}
          {mailing.dueNext14Days && <span className="flag flag-amber">Next batch</span>}
          {!mailing.shipDate && <span className="flag flag-rose">No date</span>}
        </div>
      </td>
    </tr>
  );
}
