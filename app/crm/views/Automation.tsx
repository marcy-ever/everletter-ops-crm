// Phase 1, step 6 of the app.js decomposition (CLAUDE.md) - the first view
// migrated out of app/crm/legacy-app.js into a real, typed React
// component. Chosen first deliberately because it's the smallest view in
// the app: static content plus one map() over automationRules, no event
// handlers, no writes, no filters - so getting the hosting seam and test
// story right costs nothing if this one component turns out wrong.
//
// Receives its data as a prop, not read from a global. The legacy
// function this replaces (renderAutomation(), removed from
// app/crm/legacy-app.js by this same change) called a helper
// (defaultAutomationRules()) that reached into window.EVERLETTER_SEED/
// state.seed directly - exactly the kind of implicit dependency this
// migration exists to remove. app/crm/CrmApp.tsx (the only caller) reads
// state.seed.automationRules itself and passes the result in, so this
// component can be reasoned about, and tested, completely locally.
//
// Markup, classes, text, and DOM structure are unchanged from
// renderAutomation()'s template-literal output (verified against
// tests/snapshots/automation.html by tests/automation-view.test.mjs,
// under a normalized-whitespace comparison - see that file's own header
// for why byte-identity isn't the achievable or right gate here). Text
// interpolation ({title}, {copy}, {rule.rule}, {rule.logic}) is JSX's own
// automatic escaping, replacing the legacy code's explicit escapeHtml()
// calls - same protection, no manual call needed.

export interface AutomationRule {
  rule: string;
  logic: string;
}

interface FlowStep {
  icon: string;
  title: string;
  copy: string;
}

const FLOW_STEPS: FlowStep[] = [
  { icon: "1", title: "Squarespace order arrives", copy: "Webhook or scheduled API sync captures the raw order exactly once." },
  { icon: "2", title: "Match account", copy: "Use Squarespace customer ID first, email second. One email can own multiple subscriptions." },
  { icon: "3", title: "Match subscription sequence", copy: "Use recipient, address, character, and plan to find the exact subscription under that account." },
  { icon: "4", title: "Continue letter sequence", copy: "Find the highest existing letter number for that exact subscription sequence." },
  { icon: "5", title: "Calculate 1st/15th batches", copy: "Apply the 3-day cutoff and two-letter monthly cadence automatically." },
  { icon: "6", title: "Generate mailings", copy: "Month-to-month creates two monthly mailings. 6-month creates 12. 12-month creates 24." },
  { icon: "7", title: "Gate exceptions", copy: "Missing dates, addresses, characters, emails, or unclear subscription matches stop before production." },
];

export interface AutomationProps {
  automationRules: AutomationRule[];
}

export default function Automation({ automationRules }: AutomationProps) {
  return (
    <section className="automation-layout" aria-label="Automation map">
      <div className="automation-column">
        <h3>Live order flow</h3>
        <ol className="flow-list">
          {FLOW_STEPS.map((step) => (
            <li key={step.icon}>
              <span className="step-icon">{step.icon}</span>
              <div>
                <strong>{step.title}</strong>
                <span>{step.copy}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="automation-column">
        <h3>Rules to lock before connecting Squarespace</h3>
        <div className="rule-stack">
          {automationRules.map((rule, index) => (
            <article className="rule-item" key={index}>
              <strong>{rule.rule}</strong>
              <p>{rule.logic}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
