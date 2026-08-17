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

const PLAN_OPTIONS = ["Month-to-month", "6-month", "12-month", "One-time"];

export interface SyncProps {
  data: SyncPreviewData;
  onSubscriberChange: (subscriberId: string) => void;
  onPlanChange: (plan: string) => void;
  onOrderDateChange: (orderDate: string) => void;
  onSubscriptionChange: (subscriptionId: string) => void;
}

export default function Sync({ data, onSubscriberChange, onPlanChange, onOrderDateChange, onSubscriptionChange }: SyncProps) {
  return (
    <section className="data-panel sync-panel" aria-label="Squarespace sync simulator">
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
    </section>
  );
}
