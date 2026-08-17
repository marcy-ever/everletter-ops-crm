// Phase 1, step 9 of the app.js decomposition (CLAUDE.md) - the fourth
// view migrated out of app/crm/legacy-app.js.
//
// Input-handling shape: props with callbacks, same as Sync.tsx (step 8) -
// no hook over the store, no direct `state` access here. `data` is
// computed by samples-selectors.ts's computeSamplesData() and the two
// callbacks are supplied by app/crm/CrmApp.tsx, the only place (besides
// legacy-app.js itself) allowed to touch `state` for a React-hosted view.
//
// onOpenSample is a new shape this view introduces: a callback that
// performs a browser action (window.open) rather than mutating `state` -
// CrmApp.tsx's implementation doesn't call notifyViewChanged() for it,
// since nothing rendered depends on whether a sample was opened.
// onSampleTypeChange is the familiar shape (mutate state.sampleType, then
// notifyViewChanged()) - same as every Sync.tsx callback.
//
// data-sample-type/data-open-sample stay in the markup as inert
// attributes (same markup, same classes, per the task) even though
// they're no longer what wires up the click - onClick now does that
// directly, replacing legacy's post-render
// viewMount.querySelectorAll('[data-sample-type]')/
// viewMount.querySelectorAll('[data-open-sample]') bindings (removed from
// legacy-app.js by this same change), which re-bound on every render and
// would have found nothing once this view renders into #reactViewMount
// instead of #viewMount.
//
// Text interpolation is JSX's own automatic escaping, replacing legacy's
// explicit escapeHtml() calls - same protection, no manual call needed
// (see Automation.tsx's own header for the same note). statusClass/number
// still come from app/crm/format.ts, same as every other migrated view
// that needs them.

import { statusClass, number } from "../../format";
import type { SamplesData } from "./samples-selectors";

export interface SamplesProps {
  data: SamplesData;
  onSampleTypeChange: (type: string) => void;
  onOpenSample: (file: string) => void;
}

export default function Samples({ data, onSampleTypeChange, onOpenSample }: SamplesProps) {
  return (
    <section className="data-panel samples-panel" aria-label="Sample requests">
      <div className="panel-head">
        <div>
          <h3>Sample Requests</h3>
          <p>Future intake flow for website sample requests. Mailchimp can send these; the CRM should track them.</p>
        </div>
        <span className="panel-count">Mailchimp setup pending</span>
      </div>
      <div className="samples-layout">
        <div className="sample-card sample-primary">
          <span className="sample-badge">Recommendation</span>
          <h4>Set up Mailchimp, but do not delay CRM launch for it.</h4>
          <p>For today, use the CRM for mailings. Next, we connect the website form to Mailchimp and the CRM so sample requests stop arriving as manual Gmail-only work.</p>
          <div className="sample-toggle" role="group" aria-label="Sample type">
            {["Kid", "Adult"].map((type) => (
              <button
                type="button"
                key={type}
                className={data.sampleType === type ? "active" : ""}
                data-sample-type={type}
                onClick={() => onSampleTypeChange(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        <div className="sample-card">
          <h4>Mailchimp fields to create</h4>
          <dl className="sample-fields">
            <div>
              <dt>Tag</dt>
              <dd>{data.sampleType === "Kid" ? "sample-kid" : "sample-adult"}</dd>
            </div>
            <div>
              <dt>Merge field</dt>
              <dd>SAMPLETYPE</dd>
            </div>
            <div>
              <dt>Journey</dt>
              <dd>Everletter Sample Request</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Requested / Sent / Converted</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="sample-library">
        <div className="sample-library-head">
          <div>
            <h4>Sample Letter Library</h4>
            <p>These should be saved in Drive and attached or linked from Mailchimp so the sample still feels like real mail.</p>
          </div>
          <span className="sample-badge">{number(data.sampleAssets.length)} ready</span>
        </div>
        <div className="sample-preview-grid">
          {data.sampleAssets.map((asset) => (
            <article className="sample-preview-card" key={asset.file}>
              <button type="button" data-open-sample={asset.file} aria-label={`Open ${asset.title}`} onClick={() => onOpenSample(asset.file)}>
                <img src={asset.file} alt={`${asset.title} sample letter preview`} />
              </button>
              <div>
                <span className="sample-badge">{asset.type}</span>
                <h5>{asset.title}</h5>
                <p>{asset.note}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="sample-flow">
        {data.flows.map((flow, index) => (
          <article key={flow.title}>
            <span>{index + 1}</span>
            <strong>{flow.title}</strong>
            <p>{flow.detail}</p>
          </article>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sample Type</th>
              <th>Mailchimp Tag</th>
              <th>Email Template</th>
              <th>CRM Result</th>
            </tr>
          </thead>
          <tbody>
            {data.sampleRows.map((row) => (
              <tr key={row.type}>
                <td>
                  <strong>{row.type}</strong>
                </td>
                <td className="mono">{row.tag}</td>
                <td>{row.template}</td>
                <td>
                  <span className={`pill status-${statusClass(row.status)}`}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
