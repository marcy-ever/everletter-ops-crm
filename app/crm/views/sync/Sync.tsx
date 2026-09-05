// Phase 1, step 8 of the app.js decomposition (CLAUDE.md) - the third
// view migrated out of app/crm/legacy-app.js, and the first with form
// controls (Automation and Launch Plan were both read-only).
//
// Input-handling shape: props with callbacks, same as every other prop
// this component receives - no hook over the store, no direct `state`
// access here at all. `data` is computed by sync-selectors.ts's
// computeSyncPreview() and the four onXxxChange callbacks are supplied by
// app/crm/CrmApp.tsx, which is the only place (besides legacy-app.js
// itself) allowed to touch `state` for a React-hosted view - each
// callback does exactly what the legacy <select>/<input> onchange
// handlers it replaces did (write into `state`, then trigger a
// re-render), just relocated. Chosen over a hook (e.g. a component-local
// useSyncExternalStore) specifically so every migrated view - read-only
// or interactive - has the identical shape: plain props in, JSX out, no
// coupling to the store or hooks inside the component itself. That keeps
// this component trivially testable with renderToStaticMarkup and a
// hand-built `data` object (see tests/sync-view.test.mjs), the same way
// Automation.tsx/LaunchPlan.tsx already are, and it's the shape every
// remaining interactive view (Needs Review, Import, Production Queue, QA,
// Packet, Bins, Subscribers) should inherit - a per-row callback prop
// (onStatusChange(mailing, status), say) is the natural extension of
// this same pattern, not a different one.
//
// Markup/classes/text unchanged from the removed renderSync()
// (app/crm/legacy-app.js, deleted by this same change) - including the
// exact mojibake separator sync-selectors.ts's option labels already
// carry (see that module's own header for why it's not "fixed" here).

import { formatDate } from "@/lib/domain/format";
import { number } from "../../format";
import type { SyncPreviewData } from "./sync-selectors";
import type { SquarespacePreviewState } from "@/lib/domain/squarespace-preview";

const PLAN_OPTIONS = ["Month-to-month", "6-month", "12-month", "One-time"];

export interface SyncProps {
  data?: SyncPreviewData;
  onSubscriberChange: (subscriberId: string) => void;
  onPlanChange: (plan: string) => void;
  onOrderDateChange: (orderDate: string) => void;
  onSubscriptionChange: (subscriptionId: string) => void;
  squarespacePreview?: SquarespacePreviewState | null;
  onRefreshSquarespace?: () => void;
  onStageSquarespace?: (order: SquarespacePreviewState["orders"][number]) => Promise<void>;
  onCustomerClick?: (subscriberId: string) => void;
}

export default function Sync({ data, onSubscriberChange, onPlanChange, onOrderDateChange, onSubscriptionChange, squarespacePreview, onRefreshSquarespace, onStageSquarespace = async () => {}, onCustomerClick = () => {} }: SyncProps) {
  const actionableSquarespaceOrders = squarespacePreview?.orders.filter((order) => !order.existing && order.reviewStatus !== "Imported" && order.reviewStatus !== "Ignored") ?? [];
  return (
    <>
    {squarespacePreview !== undefined && (
      <section className="data-panel squarespace-preview" aria-label="Squarespace order preview">
        <div className="panel-head">
          <div>
            <h3>Squarespace Orders</h3>
            <p>New paid orders are automatically sent to Needs Review.</p>
          </div>
          <button className="btn secondary" type="button" onClick={onRefreshSquarespace} disabled={squarespacePreview?.loading}>Refresh</button>
        </div>
        <div className="squarespace-warnings">Automatic checks: {squarespacePreview?.lastCheckedAt ? `last checked ${new Date(squarespacePreview.lastCheckedAt).toLocaleString()}` : "starting"} · {number(squarespacePreview?.pendingReviewCount)} waiting for review</div>
        {squarespacePreview?.loading && <div className="empty-state">Checking Squarespace…</div>}
        {squarespacePreview?.failed && <div className="empty-state error-state">{squarespacePreview.message}</div>}
        {!squarespacePreview?.loading && !squarespacePreview?.failed && !actionableSquarespaceOrders.length && <div className="empty-state">No new orders need attention.</div>}
        {!!actionableSquarespaceOrders.length && (
          <div className="squarespace-order-list">
            {actionableSquarespaceOrders.map((order) => (
              <article className={`squarespace-order-card ${order.warnings.length ? "has-warning" : ""}`} key={order.id}>
                <div className="squarespace-order-head">
                  <div><strong>Order #{order.orderNumber}</strong><span>{formatDate(order.createdOn.slice(0, 10))}</span></div>
                  <span className={`pill ${order.existing || order.reviewStatus === "Imported" ? "status-mailed" : "status-to-prepare"}`}>{order.existing || order.reviewStatus === "Imported" ? "Already in Everletter" : order.reviewStatus === "Pending" ? "In Needs Review" : order.reviewStatus === "Ignored" ? "Ignored" : "New"}</span>
                </div>
                <h4>{order.subscriberId ? <button type="button" className="link-button recipient-profile-link" onClick={() => onCustomerClick(order.subscriberId!)}>{order.customerName}</button> : order.customerName}</h4>
                <p>{order.customerEmail || "Missing email"}</p>
                <p>{order.shippingAddress || "Missing mailing address"}</p>
                <p><strong>{order.products.join(", ") || "No products found"}</strong></p>
                <p><strong>Everletter:</strong> {order.recipientName || "Recipient needs review"} · {order.character} · {order.plan}</p>
                {!!order.details.length && <p className="squarespace-order-details">{order.details.join(" · ")}</p>}
                {!!order.warnings.length && <div className="squarespace-warnings">Needs review: {order.warnings.join(" · ")}</div>}
                {!order.existing && !order.reviewStatus && <button type="button" className="profile-button" onClick={async (event) => {
                  const card = event.currentTarget.closest("article"); const message = card?.querySelector("[data-squarespace-stage-message]");
                  try { await onStageSquarespace(order); if (message) message.textContent = "Sent to Needs Review."; }
                  catch (error) { if (message) message.textContent = error instanceof Error ? error.message : "Could not send this order."; }
                }}>Send to Needs Review</button>}
                <small role="status" data-squarespace-stage-message />
              </article>
            ))}
            {squarespacePreview?.hasMore && <p className="muted">Showing the 50 most recently changed orders.</p>}
          </div>
        )}
      </section>
    )}
    {squarespacePreview === undefined && data && <section className="data-panel sync-panel" aria-label="Squarespace sync simulator">
      <div className="panel-head">
        <div>
          <h3>Squarespace Sync Simulator</h3>
          <p>Preview how a daily sync turns a renewal order into the next Everletter mailings.</p>
        </div>
        <span className="panel-count">Daily sync</span>
      </div>

      <div className="sync-layout">
        <div className="sync-form">
          <label>
            <span>Existing subscriber</span>
            <select id="syncSubscriber" value={data.subscriber.subscriberId} onChange={(event) => onSubscriberChange(event.target.value)}>
              {data.subscriberOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Plan / order type</span>
            <select id="syncPlan" value={data.plan} onChange={(event) => onPlanChange(event.target.value)}>
              {PLAN_OPTIONS.map((plan) => (
                <option key={plan}>{plan}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Order paid date</span>
            <input id="syncOrderDate" type="date" value={data.orderDate} onChange={(event) => onOrderDateChange(event.target.value)} />
          </label>
          <label>
            <span>Subscription sequence</span>
            <select id="syncSubscription" value={data.subscription.subscriptionId} onChange={(event) => onSubscriptionChange(event.target.value)}>
              {data.subscriptionOptions.length ? (
                data.subscriptionOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))
              ) : (
                <option>{data.subscription.subscriptionId}</option>
              )}
            </select>
          </label>
        </div>

        <div className="sync-summary">
          <h4>{data.subscriber.displayName}</h4>
          <p>
            {data.subscriber.email || "Missing email"} Â· {data.subscriber.subscriberId}
          </p>
          <p>
            {data.recipientName} Â· {data.subscription.character} Â· {data.subscription.plan}
          </p>
          <dl>
            <div>
              <dt>Existing letters</dt>
              <dd>{number(data.existingCount)}</dd>
            </div>
            <div>
              <dt>Highest letter #</dt>
              <dd>{number(data.currentMax)}</dd>
            </div>
            <div>
              <dt>New letters</dt>
              <dd>{number(data.newCount)}</dd>
            </div>
            <div>
              <dt>Order number</dt>
              <dd>New in Squarespace</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="generated-mailings">
        <h4>Generated mailing rows</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Letter #</th>
                <th>Ship Date</th>
                <th>Status</th>
                <th>Mailing ID</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {data.generated.map((row) => (
                <tr key={row.mailingId}>
                  <td>{row.letterNumber}</td>
                  <td>{formatDate(row.shipDate)}</td>
                  <td>
                    <span className="pill status-to-prepare">To Prepare</span>
                  </td>
                  <td className="mono">{row.mailingId}</td>
                  <td>Next letter after #{number(data.currentMax)} for this exact recipient + character subscription.</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>}
    </>
  );
}
