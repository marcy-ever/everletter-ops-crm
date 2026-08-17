// Phase 1, step 10 of the app.js decomposition (CLAUDE.md) - the fifth
// view migrated out of app/crm/legacy-app.js, and the first that writes
// to the server.
//
// Input-handling shape: props with callbacks, same as every migrated
// interactive view since step 8. `rows` is computed by
// exceptions-selectors.ts's computeExceptionRows() and onReview is
// supplied by app/crm/CrmApp.tsx, the only place (besides legacy-app.js
// itself) allowed to touch `state` for a React-hosted view.
//
// onReview is the new thing this step introduces: unlike Sync's/Samples'
// callbacks, it isn't a simple client-side mutation - CrmApp.tsx's
// implementation mirrors the removed legacy [data-review] handler's full
// body exactly (state.reviewed.add(key), persist to localStorage, POST
// kind: "reviewedException" to /api/shared-state, then the shell/view
// refresh - see that file's own header for why it's render(), not just
// notifyViewChanged()). This component only needs to know it's a callback
// taking the review key - everything about what reviewing actually DOES
// stays out of the presentational layer, same separation every other
// migrated view already draws.
//
// data-review stays in the markup as an inert attribute (same markup, per
// the task, and the exact key format - mailingId::subscriberId::reason::
// shipDate - existing overrides on the server depend on staying stable)
// even though onClick now does the actual wiring, replacing legacy's
// post-render viewMount.querySelectorAll('[data-review]') binding
// (removed from legacy-app.js by this same change).
//
// Text interpolation is JSX's own automatic escaping, replacing legacy's
// explicit escapeHtml() calls - same protection, no manual call needed
// (see Automation.tsx's own header for the same note).

import { formatDate } from "@/lib/domain/format";
import { exceptionReviewKey } from "@/lib/domain/keys";
import type { DatasetException } from "@/lib/domain/dataset";

export interface ExceptionsProps {
  rows: DatasetException[];
  onReview: (key: string) => void;
}

export default function Exceptions({ rows, onReview }: ExceptionsProps) {
  return (
    <section className="data-panel" aria-label="Exceptions">
      <div className="panel-head">
        <div>
          <h3>Needs Review</h3>
          <p>Bad data stops here instead of leaking into the mailing schedule.</p>
        </div>
        <span className="panel-count">{rows.length} open</span>
      </div>
      <div className="exception-list">
        {rows.length ? (
          rows.map((item) => <ExceptionRow item={item} onReview={onReview} key={exceptionReviewKey(item)} />)
        ) : (
          <div className="empty-state">Nothing matches this search. Nicely suspicious.</div>
        )}
      </div>
    </section>
  );
}

function ExceptionRow({ item, onReview }: { item: DatasetException; onReview: (key: string) => void }) {
  const key = exceptionReviewKey(item);
  return (
    <article className="exception-row">
      <div className={`severity severity-${item.severity.toLowerCase()}`}>{item.severity}</div>
      <div>
        <h4>{item.recipientName}</h4>
        <p>{item.reason}</p>
        {item.suggestedShipDate && (
          <div className="suggested-date">
            <span>Suggested ship date</span>
            <strong>{formatDate(item.suggestedShipDate)}</strong>
          </div>
        )}
        <div className="row-meta">
          <span>{formatDate(item.shipDate)}</span>
          <span>{item.status}</span>
          {item.sourceRow == null ? null : <span>Sheet row {item.sourceRow}</span>}
          <span className="mono">{item.mailingId}</span>
        </div>
      </div>
      <button type="button" className="icon-action" data-review={key} onClick={() => onReview(key)}>
        Reviewed
      </button>
    </article>
  );
}
