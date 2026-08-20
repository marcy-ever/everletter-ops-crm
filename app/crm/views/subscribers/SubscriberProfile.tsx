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
  onPrintAllEnvelopes: (mailings: ProfileMailingRow[]) => void;
  onPrintEnvelope: (mailing: ProfileMailingRow) => void;
  onMarkPrinted: (mailing: ProfileMailingRow) => void;
  onMarkAshley: (mailing: ProfileMailingRow) => void;
  onNeedsDoneChange: (mailing: ProfileMailingRow, value: string) => void;
  onCustomerStatusChange: (active: boolean) => void;
  selectedSubscriptionId: string;
  onSubscriptionChange: (subscriptionId: string) => void;
}

export default function SubscriberProfile({ data, onPrintAllEnvelopes, onPrintEnvelope, onMarkPrinted, onMarkAshley, onNeedsDoneChange, onCustomerStatusChange, selectedSubscriptionId, onSubscriptionChange }: SubscriberProfileProps) {
  const { subscriber, allRows, openRows } = data;
  const isActive = subscriber.status === "Active";
  const visibleRows = selectedSubscriptionId === "all" ? allRows : allRows.filter((mailing) => mailing.subscriptionId === selectedSubscriptionId);
  const visibleOpenRows = visibleRows.filter((mailing) => mailing.status !== "Mailed" && mailing.activeState === "Active");
  const currentMailingKey = mailingKey(visibleOpenRows[0] ?? visibleRows[visibleRows.length - 1] ?? { mailingId: "", sourceRow: 0 });
  return (
    <aside className="subscriber-profile" aria-label="Subscriber profile">
      <div className="subscriber-profile-head">
        <div>
          <p className="section-label">Customer Profile</p>
          <h3>{subscriber.displayName}</h3>
          <p>{subscriber.email || "Needs email"}</p>
        </div>
        <div className="profile-head-actions">
          <details className="customer-status-control">
            <summary className="customer-active-toggle" role="switch" aria-checked={isActive}>
              <span className="customer-toggle-track" aria-hidden="true"><span /></span>
              <span>{isActive ? "Active" : "Inactive"}</span>
            </summary>
            <div className="customer-status-confirm" role="alert">
              <div>
                <strong>Confirm {isActive ? "deactivation" : "reactivation"}</strong>
                <span>
                  {isActive
                    ? `${subscriber.displayName} will stay searchable, but will be removed from operational mailing views.`
                    : `${subscriber.displayName} will return to operational mailing views.`}
                </span>
              </div>
              <button
                type="button"
                className="profile-button"
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              >
                Cancel
              </button>
              <button type="button" className="profile-button customer-status-confirm-button" onClick={() => onCustomerStatusChange(!isActive)}>
                Confirm {isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </details>
          <button type="button" className="profile-button profile-print-all" onClick={() => onPrintAllEnvelopes(visibleRows)} disabled={!visibleRows.length}>
            Print All Envelopes
          </button>
          <span className="panel-count">{number(visibleOpenRows.length)} open</span>
        </div>
      </div>
      {data.subscriptionChoices.length > 1 ? (
        <div className="profile-subscription-picker" aria-label="Choose subscription">
          <span>Subscription</span>
          <button type="button" className={selectedSubscriptionId === "all" ? "active" : ""} onClick={() => onSubscriptionChange("all")}>All</button>
          {data.subscriptionChoices.map((choice) => (
            <button
              type="button"
              className={selectedSubscriptionId === choice.subscriptionId ? "active" : ""}
              onClick={() => onSubscriptionChange(choice.subscriptionId)}
              key={choice.subscriptionId}
            >
              {choice.character} <small>{choice.plan}</small>
            </button>
          ))}
        </div>
      ) : null}
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
              <th>Needs Done</th>
              <th>Envelope Status</th>
              <th>Envelope</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? (
              visibleRows.map((mailing) => (
                <tr
                  key={mailingKey(mailing)}
                  className={mailingKey(mailing) === currentMailingKey ? "profile-current-mailing" : undefined}
                  ref={mailingKey(mailing) === currentMailingKey ? (row) => row?.scrollIntoView({ block: "center" }) : undefined}
                >
                  <td>{formatDate(mailing.shipDate)}</td>
                  <td>{mailing.character}</td>
                  <td>{mailing.plan}</td>
                  <td>{mailing.letterNumber}</td>
                  <td>
                    <span className={`pill status-${statusClass(mailing.status)}`}>{mailing.status}</span>
                  </td>
                  <td>
                    <input
                      className="needs-done-input"
                      defaultValue={mailing.needsDone}
                      placeholder="What needs done?"
                      maxLength={500}
                      aria-label={`Needs done for ${mailing.character} letter ${mailing.letterNumber}`}
                      onBlur={(event) => onNeedsDoneChange(mailing, event.currentTarget.value.trim())}
                    />
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
                <td colSpan={8} className="empty-state">
                  No mailings for this customer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mobile-card-list profile-mobile-cards">
        {visibleRows.length ? (
          visibleRows.map((mailing) => (
            <article className={mailingKey(mailing) === currentMailingKey ? "mobile-action-card profile-current-mailing" : "mobile-action-card"} key={mailingKey(mailing)}>
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
              <label className="mobile-needs-done">
                <span>Needs Done</span>
                <input
                  className="needs-done-input"
                  defaultValue={mailing.needsDone}
                  placeholder="What needs done?"
                  maxLength={500}
                  onBlur={(event) => onNeedsDoneChange(mailing, event.currentTarget.value.trim())}
                />
              </label>
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
          <div className="empty-state">No mailings for this customer.</div>
        )}
      </div>
    </aside>
  );
}
