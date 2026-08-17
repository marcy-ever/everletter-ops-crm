// Phase 1, step 12 of the app.js decomposition (CLAUDE.md) - the profile
// pane half of the Subscribers view, the largest view migrated so far.
// Renders both a desktop table and a mobile card list for the same open-
// mailings data - the first migrated view to need both (every prior view
// with a table had no mobile-card counterpart, or vice versa).
//
// Props with callbacks, same shape as every interactive view since step
// 8. Each callback receives the full ProfileMailingRow, not a key string
// to re-look-up - the component already has the row in scope from its
// own map(), so there's no need to reproduce legacy's
// effectiveMailings().find(mailingKey(mailing) === ...) indirection here.
//
// onPrintEnvelope calls the still-legacy envelopePrintRows()/
// openEnvelopePrint() (exported unchanged from legacy-app.js - the
// envelope print generator itself is explicitly out of scope for this
// step, owned by step 17). onMarkPrinted/onMarkAshley call the existing
// updateEnvelopeStatus()/updateMailingStatus() mutators
// (lib/client/crm-state.ts) - already the standard write-through path,
// unchanged. See app/crm/CrmApp.tsx's own comment for why these two
// call notifyViewChanged() rather than render(), despite mutating
// state.statusOverrides/componentOverrides - a real, reported finding,
// not an oversight: legacy's own renderSubscribers()-calling handlers
// never called render() either.
//
// data-profile-print-envelope/data-profile-mark-envelope/
// data-profile-mark-ashley stay in the markup as inert attributes (same
// markup, same key format - mailingKey(mailing) - per the task) even
// though onClick now does the actual wiring.

import { formatDate } from "@/lib/domain/format";
import { mailingKey } from "@/lib/domain/keys";
import { statusClass, number } from "../../format";
import type { ProfileMailingRow, SubscriberProfileData } from "./subscribers-selectors";

export interface SubscriberProfileProps {
  data: SubscriberProfileData;
  onPrintEnvelope: (mailing: ProfileMailingRow) => void;
  onMarkPrinted: (mailing: ProfileMailingRow) => void;
  onMarkAshley: (mailing: ProfileMailingRow) => void;
}

export default function SubscriberProfile({ data, onPrintEnvelope, onMarkPrinted, onMarkAshley }: SubscriberProfileProps) {
  const { subscriber, openRows } = data;
  return (
    <aside className="subscriber-profile" aria-label="Subscriber profile">
      <div className="subscriber-profile-head">
        <div>
          <p className="section-label">Customer Profile</p>
          <h3>{subscriber.displayName}</h3>
          <p>{subscriber.email || "Needs email"}</p>
        </div>
        <span className="panel-count">{number(openRows.length)} open</span>
      </div>
      <dl className="profile-stats">
        <div>
          <dt>Status</dt>
          <dd>{subscriber.status}</dd>
        </div>
        <div>
          <dt>Recipients</dt>
          <dd>{number(data.recipientCount)}</dd>
        </div>
        <div>
          <dt>Total mailings</dt>
          <dd>{number(data.totalMailings)}</dd>
        </div>
        <div>
          <dt>Open envelopes</dt>
          <dd>{number(data.totalEnvelopeCount)}</dd>
        </div>
      </dl>
      <div className="table-wrap profile-mailings">
        <table>
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Character</th>
              <th>Plan</th>
              <th>Letter</th>
              <th>Status</th>
              <th>Envelope Status</th>
              <th>Envelope</th>
            </tr>
          </thead>
          <tbody>
            {openRows.length ? (
              openRows.map((mailing) => (
                <tr key={mailingKey(mailing)}>
                  <td>{formatDate(mailing.shipDate)}</td>
                  <td>{mailing.character}</td>
                  <td>{mailing.plan}</td>
                  <td>{mailing.letterNumber}</td>
                  <td>
                    <span className={`pill status-${statusClass(mailing.status)}`}>{mailing.status}</span>
                  </td>
                  <td>
                    <span className={`pill status-${statusClass(mailing.envelopeStatus)}`}>{mailing.envelopeStatus}</span>
                  </td>
                  <td>
                    <button type="button" className="link-button" data-profile-print-envelope={mailingKey(mailing)} onClick={() => onPrintEnvelope(mailing)}>
                      Print Envelope
                    </button>
                    <button type="button" className="link-button" data-profile-mark-envelope={mailingKey(mailing)} onClick={() => onMarkPrinted(mailing)}>
                      Mark Printed
                    </button>
                    <button type="button" className="link-button" data-profile-mark-ashley={mailingKey(mailing)} onClick={() => onMarkAshley(mailing)}>
                      Mark At Ashley
                    </button>
                    <span>
                      {number(mailing.envelopeQuantity)} envelope{mailing.envelopeQuantity === 1 ? "" : "s"}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="empty-state">
                  No open mailings for this customer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mobile-card-list profile-mobile-cards">
        {openRows.length ? (
          openRows.map((mailing) => (
            <article className="mobile-action-card" key={mailingKey(mailing)}>
              <div className="mobile-card-head">
                <div>
                  <strong>{formatDate(mailing.shipDate)}</strong>
                  <span>
                    {mailing.character} Â· Letter {mailing.letterNumber}
                  </span>
                </div>
                <span className={`pill status-${statusClass(mailing.status)}`}>{mailing.status}</span>
              </div>
              <dl>
                <div>
                  <dt>Plan</dt>
                  <dd>{mailing.plan}</dd>
                </div>
                <div>
                  <dt>Envelope</dt>
                  <dd>{mailing.envelopeStatus}</dd>
                </div>
                <div>
                  <dt>Qty</dt>
                  <dd>{number(mailing.envelopeQuantity)}</dd>
                </div>
              </dl>
              <div className="mobile-card-actions">
                <button type="button" className="link-button" data-profile-print-envelope={mailingKey(mailing)} onClick={() => onPrintEnvelope(mailing)}>
                  Print Envelope
                </button>
                <button type="button" className="link-button" data-profile-mark-envelope={mailingKey(mailing)} onClick={() => onMarkPrinted(mailing)}>
                  Mark Printed
                </button>
                <button type="button" className="link-button" data-profile-mark-ashley={mailingKey(mailing)} onClick={() => onMarkAshley(mailing)}>
                  At Ashley
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">No open mailings for this customer.</div>
        )}
      </div>
    </aside>
  );
}
