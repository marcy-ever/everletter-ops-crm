// Phase 1, step 12 of the app.js decomposition (CLAUDE.md) - the largest
// view migrated so far, and the first that reads state.query without
// owning the control that sets it: the search box lives in the shell
// (#searchInput, app/crm/shell/init-crm-app.ts's initCrmApp()), outside
// this view's mount entirely - filtering here is driven purely by the `rows`
// prop CrmApp.tsx recomputes on every notifyViewChanged(), the same
// signal the shell's own search-input handler already fires
// (searchInput.addEventListener('input', ...) calls renderView(), which
// ends in notifyViewChanged() - unchanged by this migration). No new
// plumbing needed, but worth confirming directly rather than assuming -
// see tests/subscribers-view.test.mjs's own coverage of this.
//
// Input-handling shape: props with callbacks, same as every interactive
// view since step 8. SubscriberCard is a small nested component (same
// shape as Exceptions.tsx's ExceptionRow, step 10); SubscriberProfile is
// its own file since it's substantial on its own (a desktop table AND a
// mobile card list, plus three actions - see that file's own header).

import { formatDate } from "@/lib/domain/format";
import { number } from "../../format";
import type { DatasetSubscriber } from "@/lib/domain/dataset";
import SubscriberProfile, { type SubscriberProfileProps } from "./SubscriberProfile";

export interface SubscribersProps {
  rows: DatasetSubscriber[];
  selected: DatasetSubscriber | null;
  onSelect: (subscriberId: string) => void;
  profile: SubscriberProfileProps["data"] | null;
  onPrintEnvelope: SubscriberProfileProps["onPrintEnvelope"];
  onMarkPrinted: SubscriberProfileProps["onMarkPrinted"];
  onMarkAshley: SubscriberProfileProps["onMarkAshley"];
  standaloneProfile?: boolean;
  onBack?: () => void;
}

export default function Subscribers({ rows, selected, onSelect, profile, onPrintEnvelope, onMarkPrinted, onMarkAshley, standaloneProfile = false, onBack }: SubscribersProps) {
  if (standaloneProfile && profile) {
    return (
      <section className="data-panel subscriber-profile-page" aria-label="Customer profile page">
        <button type="button" className="profile-button profile-back-button" onClick={onBack}>
          Back to Subscribers
        </button>
        <SubscriberProfile data={profile} onPrintEnvelope={onPrintEnvelope} onMarkPrinted={onMarkPrinted} onMarkAshley={onMarkAshley} />
      </section>
    );
  }

  return (
    <section className="data-panel" aria-label="Subscribers">
      <div className="panel-head">
        <div>
          <h3>Subscribers</h3>
          <p>Stable subscriber records inferred from email and recipient data. Archived subscribers are kept, not deleted.</p>
        </div>
        <span className="panel-count">{rows.length} shown</span>
      </div>
      <div className="subscriber-layout">
        <div className="subscriber-grid">
          {rows.map((subscriber) => (
            <SubscriberCard subscriber={subscriber} active={subscriber.subscriberId === selected?.subscriberId} onSelect={onSelect} key={subscriber.subscriberId} />
          ))}
        </div>
        {profile ? (
          <SubscriberProfile data={profile} onPrintEnvelope={onPrintEnvelope} onMarkPrinted={onMarkPrinted} onMarkAshley={onMarkAshley} />
        ) : (
          <div className="empty-state">No subscriber selected.</div>
        )}
      </div>
    </section>
  );
}

function SubscriberCard({ subscriber, active, onSelect }: { subscriber: DatasetSubscriber; active: boolean; onSelect: (subscriberId: string) => void }) {
  return (
    <article className={`subscriber-card ${active ? "subscriber-card-active" : ""}`}>
      <div className="subscriber-card-head">
        <div>
          <h4>{subscriber.displayName}</h4>
          <p>{subscriber.email || "Needs email"}</p>
        </div>
        <span className="mono">{subscriber.subscriberId}</span>
      </div>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{subscriber.status}</dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>{number(subscriber.openMailings)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{number(subscriber.totalMailings)}</dd>
        </div>
        <div>
          <dt>Issues</dt>
          <dd>{number(subscriber.issueCount)}</dd>
        </div>
        <div>
          <dt>Next ship</dt>
          <dd>{formatDate(subscriber.nextShipDate)}</dd>
        </div>
      </dl>
      <button type="button" className="profile-button" data-subscriber-select={subscriber.subscriberId} onClick={() => onSelect(subscriber.subscriberId)}>
        <span className="desktop-label">View Profile</span>
        <span className="mobile-label">View</span>
      </button>
    </article>
  );
}
