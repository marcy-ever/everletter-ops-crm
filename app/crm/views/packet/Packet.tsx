// Phase 1, step 15 of the app.js decomposition (CLAUDE.md) - the tenth
// view migrated out of app/crm/legacy-app.js, and the largest snapshot in
// the whole suite: a printable work order (four grouped work cards, two
// role checklists, a held-rows table, a final-mailing-rows table) that
// ALSO carries a mobile card list under bin-themed class names and
// `data-bin-select` attributes - a real, pre-existing oddity (see step 1's
// own snapshot work, and this component's PacketMobileCard below), not a
// naming mistake introduced by this migration. Preserved exactly: the
// class names/data-* formats reach app/globals.css and existing overrides,
// so nothing here is renamed even though "PacketMobileCard" is a better
// name for what this function now is than "binMobileCard" ever was.
//
// The mobile card's three selects are deliberately LEFT INERT - rendered
// with defaultValue (uncontrolled, no onChange) rather than value+onChange,
// reproducing a real, pre-existing gap found while migrating: legacy's own
// renderPacket() never wired a change listener for these selects at all
// (confirmed by reading the function in full and grepping every
// [data-bin-select] listener in app/crm/legacy-app.js - exactly one
// exists, inside renderBins()/Ashley Bins, for its own elements, never
// Packet's). Changing one of these selects in the live legacy app
// currently does nothing. Tempting to fix inline, but this step's own
// snapshot proof can't see the difference either way (markup is identical
// whether the select writes or not), so a fix here would be an invisible
// behavior change riding inside a "no behavior change" migration branch -
// flagged instead, left for Ashley Bins (step 16) to wire for real using
// its own real, working [data-bin-select] handler as the one source of
// truth, rather than this view reconstructing a second, unverified
// version of it. defaultValue was verified (not assumed) to produce
// byte-identical static markup to value - both render the same `selected`
// option - so this choice doesn't touch the snapshot proof either.

import { formatDate } from "@/lib/domain/format";
import { mailingKey } from "@/lib/domain/keys";
import { COMPONENT_FIELD_OPTIONS } from "@/lib/domain/component-fields";
import { number, statusClass } from "../../format";
import type { EffectiveMailing, WorkGroup } from "@/lib/client/selectors";
import type { PacketData, PacketFinalRow, PacketMobileRow, PacketProblemRow } from "./packet-selectors";

export interface PacketProps {
  data: PacketData;
  packetScope: string;
  printReadyFolderUrl: string;
  onScopeChange: (scope: string) => void;
  onPrint: () => void;
  onPrintEnvelopes: () => void;
  onOpenDriveLink: (url: string) => void;
}

export default function Packet({ data, packetScope, printReadyFolderUrl, onScopeChange, onPrint, onPrintEnvelopes, onOpenDriveLink }: PacketProps) {
  const { batchDate, rows, finalRows, mobileRows, problemRows, envelopeCount, printableEnvelopeCount, envelopeGroups, letterGroups, artifactGroups, insertGroups, marcyChecklist, ashleyChecklist } =
    data;

  return (
    <section className="data-panel packet-panel" aria-label="Batch packet">
      <div className="panel-head">
        <div>
          <h3>{batchDate ? `${formatDate(batchDate)} Batch Packet` : "Batch Packet"}</h3>
          <p>Printable work order for the whole mailing: what to print, pack, check, hold, and mark ready.</p>
        </div>
        <span className="panel-count">
          {rows.length} mailings / {number(envelopeCount)} envelopes
        </span>
      </div>

      <div className="print-summary packet-summary">
        <div>
          <span>Mailings</span>
          <strong>{number(rows.length)}</strong>
        </div>
        <div>
          <span>Total envelopes</span>
          <strong>{number(envelopeCount)}</strong>
        </div>
        <div>
          <span>Need print now</span>
          <strong>{number(printableEnvelopeCount)}</strong>
        </div>
        <div>
          <span>Do Not Mail</span>
          <strong>{number(problemRows.length)}</strong>
        </div>
      </div>

      <div className="print-toolbar" aria-label="Packet scope">
        <span>Show:</span>
        <button type="button" className={packetScope === "all" ? "active" : ""} data-packet-scope="all" onClick={() => onScopeChange("all")}>
          All open mailings
        </button>
        <button type="button" className={packetScope === "monthly" ? "active" : ""} data-packet-scope="monthly" onClick={() => onScopeChange("monthly")}>
          Month-to-month only
        </button>
      </div>

      <div className="batch-actions" aria-label="Packet actions">
        <span>Packet actions:</span>
        <button type="button" data-packet-print="" onClick={onPrint}>
          Print Packet
        </button>
        <button type="button" data-packet-envelopes="" onClick={onPrintEnvelopes}>
          Print Needed Envelopes ({number(printableEnvelopeCount)})
        </button>
        <button type="button" data-drive-url={printReadyFolderUrl} onClick={() => onOpenDriveLink(printReadyFolderUrl)}>
          Open Print-Ready Folder
        </button>
      </div>

      <div className="packet-grid">
        <PacketWorkCard title="Envelope Run" copy="Print grouped by envelope stock so you only change paper once per group." groups={envelopeGroups} unit="envelopes" />
        <PacketWorkCard title="Letter Run" copy="Print or pull these letter files before assembly starts." groups={letterGroups} unit="letters" />
        <PacketWorkCard title="Artifacts" copy="Physical extras that need a pack/check pass." groups={artifactGroups} unit="rows" />
        <PacketWorkCard title="Maps / Inserts" copy="Character-specific inserts that should be checked before stuffing." groups={insertGroups} unit="rows" />
      </div>

      <div className="packet-grid packet-grid-two">
        <PacketChecklistCard title="Marcy Checklist" items={marcyChecklist} />
        <PacketChecklistCard title="Ashley Checklist" items={ashleyChecklist} />
      </div>

      <div className="packet-section">
        <div className="panel-head packet-section-head">
          <div>
            <h3>Do Not Mail Yet</h3>
            <p>Rows here need a decision before they go into a bin.</p>
          </div>
          <span className="panel-count">{problemRows.length} held</span>
        </div>
        <div className="table-wrap">
          <table className="packet-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Character</th>
                <th>Plan</th>
                <th>Letter</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {problemRows.length ? (
                problemRows.map((row) => <PacketProblemTableRow row={row} key={mailingKey(row.mailing)} />)
              ) : (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No held rows for this packet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="packet-section">
        <div className="panel-head packet-section-head">
          <div>
            <h3>Final Mailing Rows</h3>
            <p>Use this as the physical pack list for the dated bin.</p>
          </div>
          <span className="panel-count">{rows.length} shown</span>
        </div>
        <div className="table-wrap">
          <table className="packet-table packet-final-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Character</th>
                <th>Plan</th>
                <th>Letter</th>
                <th>Env Qty</th>
                <th>Envelope</th>
                <th>Letter</th>
                <th>Artifact</th>
                <th>Insert</th>
                <th>QA</th>
              </tr>
            </thead>
            <tbody>
              {finalRows.length ? (
                finalRows.map((row) => <PacketFinalTableRow row={row} key={mailingKey(row.mailing)} />)
              ) : (
                <tr>
                  <td colSpan={10} className="empty-state">
                    Nothing in this packet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-card-list bins-mobile-cards">
          {mobileRows.length ? (
            mobileRows.map((row) => <PacketMobileCard row={row} key={mailingKey(row.mailing)} />)
          ) : (
            <div className="empty-state">No Ashley bin rows for this batch.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function PacketWorkCard({ title, copy, groups, unit }: { title: string; copy: string; groups: (WorkGroup<EffectiveMailing> & { missingLinks?: number })[]; unit: string }) {
  return (
    <article className="packet-card">
      <div>
        <h4>{title}</h4>
        <p>{copy}</p>
      </div>
      <div className="packet-list">
        {groups.length ? (
          groups.map((group) => (
            <div key={group.label}>
              <strong>{group.label}</strong>
              <span>
                {number(group.total)} {unit}
                {group.remaining ? ` Â· ${number(group.remaining)} open` : ""}
                {group.missingLinks ? ` Â· ${number(group.missingLinks)} missing links` : ""}
              </span>
            </div>
          ))
        ) : (
          <div>
            <strong>None</strong>
            <span>No rows for this packet.</span>
          </div>
        )}
      </div>
    </article>
  );
}

function PacketChecklistCard({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="packet-card packet-checklist-card">
      <h4>{title}</h4>
      <ul className="packet-checklist">
        {items.map((item, index) => (
          <li key={index}>
            <span></span>
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

function PacketProblemTableRow({ row }: { row: PacketProblemRow }) {
  const { mailing, reasons } = row;
  return (
    <tr>
      <td>
        <strong>{mailing.recipientName}</strong>
        <span>{mailing.email || "Missing email"}</span>
      </td>
      <td>{mailing.character}</td>
      <td>{mailing.plan}</td>
      <td>{mailing.letterNumber}</td>
      <td>
        <div className="flag-stack">
          {reasons.map((reason, index) => (
            <span className="flag flag-rose" key={index}>
              {reason}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

function PacketFinalTableRow({ row }: { row: PacketFinalRow }) {
  const { mailing, fieldValues } = row;
  const rowClass = row.isReady ? "qa-ready-row" : row.needsAttention ? "qa-attention-row" : "";
  return (
    <tr className={rowClass}>
      <td>
        <strong>{mailing.recipientName}</strong>
        <span>{mailing.email || "Missing email"}</span>
      </td>
      <td>{mailing.character}</td>
      <td>{mailing.plan}</td>
      <td>{mailing.letterNumber}</td>
      <td>
        <strong>{number(row.envelopeQuantity)}</strong>
      </td>
      <td>
        <span className={`pill status-${statusClass(fieldValues.envelope)}`}>{fieldValues.envelope}</span>
      </td>
      <td>
        <span className={`pill status-${statusClass(fieldValues.letter)}`}>{fieldValues.letter}</span>
      </td>
      <td>
        <span className={`pill status-${statusClass(fieldValues.artifact)}`}>{fieldValues.artifact}</span>
      </td>
      <td>
        <span className={`pill status-${statusClass(fieldValues.insert)}`}>{fieldValues.insert}</span>
      </td>
      <td>
        <span className={`pill status-${statusClass(fieldValues.qa)}`}>{fieldValues.qa}</span>
      </td>
    </tr>
  );
}

// The three selects below are deliberately uncontrolled (defaultValue, no
// onChange) - see this file's own header for why. Rendered, not wired,
// exactly matching legacy's real behavior.
function PacketMobileCard({ row }: { row: PacketMobileRow }) {
  const { mailing, status, bin, fieldValues } = row;
  return (
    <article className="mobile-action-card">
      <div className="mobile-card-head">
        <div>
          <strong>{mailing.recipientName}</strong>
          <span>{`${formatDate(mailing.shipDate)} Â· ${mailing.character} Â· Letter ${mailing.letterNumber}`}</span>
        </div>
        <span className={`pill status-${statusClass(status.label)}`}>{status.label}</span>
      </div>
      <p>{status.detail}</p>
      <dl>
        <div>
          <dt>Plan</dt>
          <dd>{mailing.plan}</dd>
        </div>
        <div>
          <dt>Bin</dt>
          <dd>{bin}</dd>
        </div>
      </dl>
      <div className="mobile-select-grid">
        <label>
          <span>Envelope</span>
          <select className={`qa-select qa-${statusClass(fieldValues.envelope)}`} data-bin-select={`${mailingKey(mailing)}::field::envelope`} defaultValue={fieldValues.envelope}>
            {COMPONENT_FIELD_OPTIONS.envelope.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Letter</span>
          <select className={`qa-select qa-${statusClass(fieldValues.letter)}`} data-bin-select={`${mailingKey(mailing)}::field::letter`} defaultValue={fieldValues.letter}>
            {COMPONENT_FIELD_OPTIONS.letter.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Location</span>
          <select className={`qa-select qa-${statusClass(fieldValues.location)}`} data-bin-select={`${mailingKey(mailing)}::field::location`} defaultValue={fieldValues.location}>
            {COMPONENT_FIELD_OPTIONS.location.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
