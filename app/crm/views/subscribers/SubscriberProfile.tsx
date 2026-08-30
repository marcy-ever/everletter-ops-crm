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
import { MAILING_STATUSES } from "@/lib/domain/mailing-rules";
import type { CustomerActivityEvent, CustomerActivityState } from "@/lib/client/customer-activity";
import type { MailingProof } from "@/lib/client/mailing-proofs";
import ProofGallery from "../../components/ProofGallery";
import { statusClass, number } from "../../format";
import type { ProfileMailingRow, SubscriberProfileData } from "./subscribers-selectors";

export interface SubscriberProfileProps {
  data: SubscriberProfileData;
  onPrintAllEnvelopes: (mailings: ProfileMailingRow[]) => void;
  onPrintEnvelope: (mailing: ProfileMailingRow) => void;
  onMarkPrinted: (mailing: ProfileMailingRow) => void;
  onMarkAshley: (mailing: ProfileMailingRow) => void;
  onNeedsDoneChange: (mailing: ProfileMailingRow, value: string) => void;
  onEmailChange: (email: string) => void;
  onLetterNumberChange: (mailing: ProfileMailingRow, value: string) => void;
  onShipDateChange: (mailing: ProfileMailingRow, value: string) => void;
  onMailingStatusChange: (mailing: ProfileMailingRow, value: string) => void;
  onCustomerStatusChange: (active: boolean) => void;
  selectedSubscriptionId: string;
  onSubscriptionChange: (subscriptionId: string) => void;
  activity: CustomerActivityState | null;
  onRefreshActivity: () => void;
  proofs: MailingProof[];
}

function activityDescription(event: CustomerActivityEvent): string {
  const labels: Record<string, string> = {
    crmDataset: "Spreadsheet imported",
    mailingStatus: "Mailing status changed",
    componentStatus: "Mailing details updated",
    reviewedException: "Review item approved",
    subscriberStatus: "Customer status changed",
    subscriberEmail: "Email updated",
    mailingLetterNumber: "Letter number changed",
    mailingShipDate: "Ship date changed",
  };
  return labels[event.kind] ?? "Customer record updated";
}

function ordinalDay(date: string): string {
  const day = Number(date.slice(8, 10));
  if (!day) return "Unknown";
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  return `${day}${suffix}`;
}

function CustomerActivity({ activity, onRefresh }: { activity: CustomerActivityState | null; onRefresh: () => void }) {
  const events = activity?.events ?? [];
  return (
    <section className="customer-activity" aria-label="Customer activity history">
      <div className="customer-activity-head">
        <div>
          <p className="section-label">Activity History</p>
          <h4>Recent changes</h4>
        </div>
        <div className="customer-activity-actions">
          {!activity?.loading ? <span className="panel-count">{events.length}</span> : null}
          <button type="button" className="profile-button" onClick={onRefresh} disabled={activity?.loading}>Refresh</button>
        </div>
      </div>
      {activity?.failed ? <p className="empty-state">Could not load activity history.</p> : null}
      {activity?.loading || !activity ? <p className="empty-state">Loading activity…</p> : null}
      {activity && !activity.loading && !activity.failed && events.length === 0 ? <p className="empty-state">No activity recorded yet.</p> : null}
      {events.length ? (
        <ol className="customer-activity-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className="customer-activity-dot" aria-hidden="true" />
              <div>
                <strong>{activityDescription(event)}</strong>
                {event.kind === "crmDataset" ? (
                  <span>{event.newValue}</span>
                ) : event.previousValue && event.previousValue !== event.newValue ? (
                  <span>{event.previousValue} → {event.newValue}</span>
                ) : (
                  <span>{event.newValue}</span>
                )}
                <small>{new Date(event.occurredAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{event.actorEmail ? ` · ${event.actorEmail}` : ""}</small>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default function SubscriberProfile({ data, onPrintAllEnvelopes, onPrintEnvelope, onMarkPrinted, onMarkAshley, onNeedsDoneChange, onEmailChange, onLetterNumberChange, onShipDateChange, onMailingStatusChange, onCustomerStatusChange, selectedSubscriptionId, onSubscriptionChange, activity, onRefreshActivity, proofs }: SubscriberProfileProps) {
  const { subscriber, allRows, openRows } = data;
  const isActive = subscriber.status === "Active";
  const visibleRows = selectedSubscriptionId === "all" ? allRows : allRows.filter((mailing) => mailing.subscriptionId === selectedSubscriptionId);
  const visibleOpenRows = visibleRows.filter((mailing) => mailing.status !== "Mailed" && mailing.activeState === "Active");
  const currentMailingKey = mailingKey(visibleOpenRows[0] ?? visibleRows[visibleRows.length - 1] ?? { mailingId: "", sourceRow: 0 });
  const progress = data.subscriptionChoices
    .filter((choice) => selectedSubscriptionId === "all" || choice.subscriptionId === selectedSubscriptionId)
    .map((choice) => {
      const rows = allRows.filter((mailing) => mailing.subscriptionId === choice.subscriptionId);
      const mailed = rows.filter((mailing) => mailing.status === "Mailed");
      const next = rows.find((mailing) => mailing.status !== "Mailed" && mailing.activeState === "Active");
      const renewalDates = rows.map((mailing) => mailing.orderDate).filter(Boolean).sort();
      const latestRenewal = renewalDates[renewalDates.length - 1] ?? "";
      return { ...choice, last: mailed[mailed.length - 1] ?? null, next, latestRenewal };
    });
  return (
    <aside className="subscriber-profile" aria-label="Subscriber profile">
      <div className="subscriber-profile-head">
        <div>
          <p className="section-label">Customer Profile</p>
          <h3>{subscriber.displayName}</h3>
          <label className="profile-email-field">
            <span>Email</span>
            <input type="email" defaultValue={subscriber.email} placeholder="Add customer email" onBlur={(event) => {
              const email = event.currentTarget.value.trim();
              if (email && email !== subscriber.email) onEmailChange(email);
            }} />
          </label>
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
      {data.customerReviewReasons.length ? (
        <div className="profile-review-alert profile-risk-warning" role="alert">
          <strong>⚠ Stop and review before mailing</strong>
          <ul>{data.customerReviewReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      ) : null}
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
      <section className="profile-progress" aria-label="Current mailing progress">
        <div className="profile-progress-head">
          <div>
            <p className="section-label">Where they are now</p>
            <h4>Current mailing progress</h4>
          </div>
        </div>
        <div className="profile-progress-grid">
          {progress.map((item) => (
            <article key={item.subscriptionId}>
              <div className="profile-progress-character">
                <strong>{item.character}</strong>
                <span>{item.plan}</span>
              </div>
              <dl>
                {item.plan === "Month-to-month" ? (
                  <div className="profile-renewal-date">
                    <dt>Monthly renewal</dt>
                    <dd>{item.latestRenewal ? `Every ${ordinalDay(item.latestRenewal)}` : "Date unknown"}</dd>
                    {item.latestRenewal ? <small>Latest: {formatDate(item.latestRenewal)}</small> : null}
                  </div>
                ) : null}
                <div>
                  <dt>Last mailed</dt>
                  <dd>{item.last ? `Letter ${item.last.letterNumber}` : "None yet"}</dd>
                  {item.last ? <small>{formatDate(item.last.shipDate)}</small> : null}
                </div>
                <div className="profile-next-letter">
                  <dt>Next mailing</dt>
                  <dd>{item.next ? `Letter ${item.next.letterNumber}` : "Complete"}</dd>
                  {item.next ? <small>{formatDate(item.next.shipDate)} · {item.next.status}</small> : null}
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
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
      <div className="profile-mailing-history-head">
        <div>
          <p className="section-label">Mailing History</p>
          <h4>Past, current, and future letters</h4>
        </div>
        <span>{visibleRows.length} letters</span>
      </div>
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
                  <td><input className="ship-date-input" type="date" defaultValue={mailing.shipDate} aria-label={`Ship date for ${mailing.character} letter ${mailing.letterNumber}`} onBlur={(event) => {
                    const value = event.currentTarget.value;
                    if (value && value !== mailing.shipDate) onShipDateChange(mailing, value);
                  }} /></td>
                  <td>{mailing.character}</td>
                  <td>{mailing.plan}</td>
                  <td><input className="letter-number-input" type="number" min="1" defaultValue={mailing.letterNumber} aria-label={`Letter number for ${mailing.character}`} onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    if (value && value !== String(mailing.letterNumber)) onLetterNumberChange(mailing, value);
                  }} /></td>
                  <td>
                    <select className={`profile-status-select status-${statusClass(mailing.status)}`} value={mailing.status} aria-label={`Status for ${mailing.character} letter ${mailing.letterNumber}`} onChange={(event) => onMailingStatusChange(mailing, event.currentTarget.value)}>
                      {MAILING_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
                    </select>
                    {mailing.reviewReasons.map((reason) => <small className="mailing-review-reason" key={reason}>{reason}</small>)}
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
                  <dt>Ship Date</dt>
                  <dd><input className="ship-date-input" type="date" defaultValue={mailing.shipDate} aria-label={`Ship date for ${mailing.character} letter ${mailing.letterNumber}`} onBlur={(event) => {
                    const value = event.currentTarget.value;
                    if (value && value !== mailing.shipDate) onShipDateChange(mailing, value);
                  }} /></dd>
                </div>
                <div>
                  <dt>Letter</dt>
                  <dd><input className="letter-number-input" type="number" min="1" defaultValue={mailing.letterNumber} aria-label={`Letter number for ${mailing.character}`} onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    if (value && value !== String(mailing.letterNumber)) onLetterNumberChange(mailing, value);
                  }} /></dd>
                </div>
                <div>
                  <dt>Plan</dt>
                  <dd>{mailing.plan}</dd>
                </div>
                <div>
                  <dt>Envelope</dt>
                  <dd>{mailing.envelopeStatus}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd><select className="profile-status-select" value={mailing.status} aria-label={`Status for ${mailing.character} letter ${mailing.letterNumber}`} onChange={(event) => onMailingStatusChange(mailing, event.currentTarget.value)}>
                    {MAILING_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
                  </select></dd>
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
      <CustomerActivity activity={activity} onRefresh={onRefreshActivity} />
      <ProofGallery proofs={proofs} />
    </aside>
  );
}
