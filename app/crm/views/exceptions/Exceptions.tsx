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
import type { BatchPhotoReviewState } from "@/lib/client/batch-mailing-photos";
import type { SquarespaceImportInput, SquarespaceOrderReviewState } from "@/lib/domain/squarespace-preview";

export interface ExceptionsProps {
  rows: DatasetException[];
  onReview: (key: string) => void;
  onCustomerClick: (subscriberId: string) => void;
  photoReviews?: BatchPhotoReviewState | null;
  onConfirmPhotoReview?: (reviewId: number, mailingId: string) => Promise<void>;
  squarespaceReviews?: SquarespaceOrderReviewState | null;
  onImportSquarespaceReview?: (reviewId: number, input: SquarespaceImportInput) => Promise<void>;
  onIgnoreSquarespaceReview?: (reviewId: number) => Promise<void>;
}

export default function Exceptions({ rows, onReview, onCustomerClick, photoReviews = null, onConfirmPhotoReview = async () => {}, squarespaceReviews = null, onImportSquarespaceReview = async () => {}, onIgnoreSquarespaceReview = async () => {} }: ExceptionsProps) {
  return (
    <section className="data-panel" aria-label="Exceptions">
      <div className="panel-head">
        <div>
          <h3>Needs Review</h3>
          <p>High-risk problems must be checked before anything is mailed.</p>
        </div>
        <span className="panel-count">{rows.length} open</span>
      </div>
      <BatchPhotoReviews state={photoReviews} onConfirm={onConfirmPhotoReview} />
      <SquarespaceReviews state={squarespaceReviews} onImport={onImportSquarespaceReview} onIgnore={onIgnoreSquarespaceReview} onCustomerClick={onCustomerClick} />
      <div className="exception-list">
        {rows.length ? (
          rows.map((item) => <ExceptionRow item={item} onReview={onReview} onCustomerClick={onCustomerClick} key={exceptionReviewKey(item)} />)
        ) : (
          <div className="empty-state">Nothing matches this search. Nicely suspicious.</div>
        )}
      </div>
    </section>
  );
}

function SquarespaceReviews({ state, onImport, onIgnore, onCustomerClick }: { state: SquarespaceOrderReviewState | null; onImport: NonNullable<ExceptionsProps["onImportSquarespaceReview"]>; onIgnore: NonNullable<ExceptionsProps["onIgnoreSquarespaceReview"]>; onCustomerClick: ExceptionsProps["onCustomerClick"] }) {
  if (state?.failed) return <p className="empty-state">Could not load Squarespace reviews.</p>;
  if (!state?.reviews.length) return null;
  return <section className="photo-review-section" aria-label="Squarespace orders needing review">
    <div className="panel-head"><div><h3>Squarespace Orders</h3><p>Staged safely. No customer or mailing has been created.</p></div><span className="panel-count">{state.reviews.length} open</span></div>
    <div className="squarespace-order-list">{state.reviews.map(({ id, order }) => <form className={`squarespace-order-card ${order.warnings.length ? "has-warning" : ""}`} key={id} onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const error = form.querySelector("[data-squarespace-import-error]");
      if (!window.confirm(`Import order #${order.orderNumber} and create its mailings?`)) return;
      try { await onImport(id, values as unknown as SquarespaceImportInput); }
      catch (caught) { if (error) error.textContent = caught instanceof Error ? caught.message : "Could not import this order."; }
    }}>
      <div className="squarespace-order-head"><strong>Order #{order.orderNumber}</strong><span className="pill status-to-prepare">Review before import</span></div>
      <label>Customer name{order.subscriberId && <button type="button" className="link-button recipient-profile-link" onClick={() => onCustomerClick(order.subscriberId!)}>Open existing customer profile</button>}<input name="customerName" defaultValue={order.customerName === "Missing name" ? "" : order.customerName} required /></label>
      <label>Email<input name="email" type="email" defaultValue={order.customerEmail} required /></label>
      <label>Recipient<input name="recipientName" defaultValue={order.recipientName} required /></label>
      <label>Address<input name="addressLine1" defaultValue={order.addressLine1 || order.shippingAddress} required /></label>
      <label>Address line 2<input name="addressLine2" defaultValue={order.addressLine2 || ""} /></label>
      <label>City<input name="city" defaultValue={order.city || ""} /></label>
      <label>State<input name="addressState" defaultValue={order.addressState || ""} /></label>
      <label>ZIP<input name="postalCode" defaultValue={order.postalCode || ""} /></label>
      <label>Character<select name="character" defaultValue={order.character}>{["Marley", "Old Marley", "Ringo", "Oliver", "Harper", "Penelope", "Marigold", "Seraphine", "Legends"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Plan<select name="plan" defaultValue={order.plan}>{["Month-to-month", "6-month", "12-month", "One-time"].map((value) => <option key={value}>{value}</option>)}</select></label>
      {!!order.warnings.length && <div className="squarespace-warnings">Needs review: {order.warnings.join(" · ")}</div>}
      <div className="profile-actions"><button type="submit" className="profile-button">Review &amp; Import</button><button type="button" className="btn secondary" onClick={async (event) => { if (!window.confirm(`Ignore Squarespace order #${order.orderNumber}?`)) return; const form = event.currentTarget.closest("form"); const error = form?.querySelector("[data-squarespace-import-error]"); try { await onIgnore(id); } catch (caught) { if (error) error.textContent = caught instanceof Error ? caught.message : "Could not ignore this order."; } }}>Ignore Order</button></div><small role="alert" data-squarespace-import-error />
    </form>)}</div>
  </section>;
}

function BatchPhotoReviews({ state, onConfirm }: { state: BatchPhotoReviewState | null; onConfirm: NonNullable<ExceptionsProps["onConfirmPhotoReview"]> }) {
  if (state?.failed) return <p className="empty-state">Could not load batch-photo reviews.</p>;
  if (!state?.reviews.length) return null;
  return (
    <section className="photo-review-section" aria-label="Batch photos needing review">
      <div className="panel-head"><div><h3>Batch Photos</h3><p>Confirm any envelope names the app could not read safely.</p></div><span className="panel-count">{state.reviews.length} open</span></div>
      <div className="photo-review-grid">{state.reviews.map((review) => <PhotoReviewCard review={review} options={state.options.filter((option) => option.shipDate === review.batchDate)} onConfirm={onConfirm} key={review.id} />)}</div>
    </section>
  );
}

function PhotoReviewCard({ review, options, onConfirm }: { review: BatchPhotoReviewState["reviews"][number]; options: BatchPhotoReviewState["options"]; onConfirm: NonNullable<ExceptionsProps["onConfirmPhotoReview"]> }) {
  return (
    <article className="photo-review-card">
      <img src={review.imageUrl} alt="Batch of envelopes needing name review" />
      <div><strong>{review.suggestedName ? `Possible match: ${review.suggestedName}` : "Name could not be read"}</strong><span>{formatDate(review.batchDate)}</span></div>
      <label><span>Attach this proof to</span><select defaultValue={review.suggestedMailingId ?? ""} data-photo-review-choice><option value="">Choose customer mailing…</option>{options.map((option) => <option value={option.mailingId} key={option.mailingId}>{option.recipientName} · {option.character} · Letter {option.letterNumber}</option>)}</select></label>
      <button type="button" className="profile-button" onClick={async (event) => {
        const card = event.currentTarget.closest("article");
        const select = card?.querySelector("[data-photo-review-choice]") as HTMLSelectElement | null;
        const error = card?.querySelector("[data-photo-review-error]");
        if (!select?.value) { if (error) error.textContent = "Choose a customer mailing first."; return; }
        try { await onConfirm(review.id, select.value); }
        catch (caught) { if (error) error.textContent = caught instanceof Error ? caught.message : "Could not confirm this envelope."; }
      }}>Confirm &amp; Mark Mailed</button>
      <small role="alert" data-photo-review-error />
    </article>
  );
}

function ExceptionRow({ item, onReview, onCustomerClick }: { item: DatasetException; onReview: (key: string) => void; onCustomerClick: (subscriberId: string) => void }) {
  const key = exceptionReviewKey(item);
  return (
    <article className={`exception-row ${item.severity === "High" ? "exception-row-critical" : ""}`}>
      <div className={`severity severity-${item.severity.toLowerCase()}`}>{item.severity}</div>
      <div>
        <h4><button type="button" className="link-button recipient-profile-link" onClick={() => onCustomerClick(item.subscriberId)}>{item.recipientName}</button></h4>
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
