// Phase 1, step 7 of the app.js decomposition (CLAUDE.md) - the second
// view migrated out of app/crm/legacy-app.js, applying the seam/transform/
// normalized-comparison pattern step 6 (Automation) established.
//
// Pure rendering only - every computed value (the checklist items, the
// today/next-batch pair, the high-exception count) comes in as `data`,
// computed by launch-selectors.ts's computeLaunchPlanData(). This
// component never touches state/window/the clock itself, same discipline
// as Automation.tsx.
//
// Markup/classes/text unchanged from the removed renderLaunch()/
// launchItem() (app/crm/legacy-app.js) - JSX's automatic text-escaping
// replaces the legacy escapeHtml() calls, same as step 6.

import { formatDate } from "@/lib/domain/format";
import { statusClass, number } from "../../format";
import type { LaunchChecklistItem, LaunchPlanData } from "./launch-selectors";

function LaunchItem({ item }: { item: LaunchChecklistItem }) {
  return (
    <div className="launch-item">
      <span className={`launch-status launch-status-${statusClass(item.status)}`}>{item.status}</span>
      <div>
        <strong>{item.label}</strong>
        <p>{item.detail}</p>
      </div>
    </div>
  );
}

export interface LaunchPlanProps {
  data: LaunchPlanData;
}

export default function LaunchPlan({ data }: LaunchPlanProps) {
  return (
    <section className="launch-layout" aria-label="Launch plan">
      <div className="launch-hero">
        <div>
          <p className="section-label">Launch mode</p>
          <h3>Get the mailing process out of spreadsheets first.</h3>
          <p>
            The CRM is ready to use as the operational checklist for the next mailing. Mailchimp is important, but it belongs in the automation wave
            after the core mailing flow stops being painful.
          </p>
        </div>
        <div className="launch-date-card">
          <span>Today</span>
          <strong>{formatDate(data.today)}</strong>
          <span>Next batch</span>
          <strong>{formatDate(data.batchDate)}</strong>
        </div>
      </div>

      <div className="launch-grid">
        <article className="data-panel launch-panel">
          <div className="panel-head">
            <div>
              <h3>Go-live checklist</h3>
              <p>Use this before the next 1st/15th mailing.</p>
            </div>
            <span className="panel-count">{number(data.highExceptionCount)} high exceptions</span>
          </div>
          <div className="launch-list">
            {data.checklist.map((item) => (
              <LaunchItem item={item} key={item.label} />
            ))}
          </div>
        </article>

        <article className="data-panel launch-panel">
          <div className="panel-head">
            <div>
              <h3>Launch order</h3>
              <p>What we should connect after the manual CRM flow is trusted.</p>
            </div>
            <span className="panel-count">Phased</span>
          </div>
          <ol className="launch-roadmap">
            {data.roadmap.map(([title, detail], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  );
}
