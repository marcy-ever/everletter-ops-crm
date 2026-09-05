// Phase 1, step 16 of the app.js decomposition (CLAUDE.md) - the
// eleventh view migrated out of app/crm/legacy-app.js. Desktop-only, on
// purpose: no mobile card list here, unlike its own naming would suggest
// (that markup lives in Batch Packet - see step 15's own PR and
// app/crm/views/bins/bins-selectors.ts's header for the real,
// pre-existing oddity, established in step 1).
//
// Input-handling shape: props with callbacks, same as every interactive
// view since step 8. onFieldChange is the REFERENCE implementation this
// migration's whole [data-bin-select] mechanism is built on - Batch
// Packet's own mobile cards (left inert in step 15) get wired to this
// same callback in this step's second, separate commit. Every real write
// site anywhere in the app for this attribute now shares this one
// definition.
//
// The bulk buttons ([data-bin-mark="ready"/"check"]) are migrated exactly
// as they are: no confirmation, no restyling, no batching, no undo - same
// rule steps 13-15's bulk buttons were migrated under, and the second of
// the two sets Marcy owns the decision on (the first was Production
// Queue's/Batch Print's bulk-status buttons).

import { formatDate } from "@/lib/domain/format";
import { mailingKey } from "@/lib/domain/keys";
import { COMPONENT_FIELD_OPTIONS } from "@/lib/domain/component-fields";
import { number, statusClass } from "../../format";
import type { EffectiveMailing } from "@/lib/client/selectors";
import type { BinGroup, BinRowData, BinsData } from "./bins-selectors";
import type { MailingProof, MailingProofUploadState } from "@/lib/client/mailing-proofs";
import ProofGallery from "../../components/ProofGallery";
import type { BatchPhotoResult } from "@/lib/client/batch-mailing-photos";

export interface BinsProps {
  data: BinsData;
  onFieldChange: (mailing: EffectiveMailing, field: string, value: string) => void;
  onBulkMark: (mode: "ready" | "check") => void;
  onPrint: () => void;
  onStart: (mailing: EffectiveMailing) => void;
  onNeedsSomething: (mailing: EffectiveMailing, need: string) => void;
  onCompleteWithPhoto: (mailing: EffectiveMailing, photo: File) => void;
  uploadStates: Record<string, MailingProofUploadState>;
  proofs: MailingProof[];
  onBatchPhoto: (batchDate: string, envelopeCount: number, photo: File) => Promise<BatchPhotoResult>;
}

export default function Bins({ data, onFieldChange, onBulkMark, onPrint, onStart = () => {}, onNeedsSomething = () => {}, onCompleteWithPhoto = () => {}, onBatchPhoto = async () => ({ matched: 0, needsReview: 0 }), uploadStates = {}, proofs = [] }: BinsProps) {
  const { batchDate, rows, groups, readyCount, needsCheckCount, missingEnvelopeCount, missingLetterCount } = data;

  return (
    <section className="data-panel bins-panel" aria-label="Ashley bins">
      <div className="panel-head">
        <div>
          <h3>{batchDate ? `${formatDate(batchDate)} Ashley Bins` : "Ashley Bins"}</h3>
          <p>Physical inventory for prepaid 6- and 12-month mailings that should already be stuffed, labeled, and stored by batch date.</p>
        </div>
        <span className="panel-count">{number(rows.length)} bin rows</span>
      </div>

      <BatchPhotoUpload batchDate={batchDate} onBatchPhoto={onBatchPhoto} />

      <div className="print-summary bin-summary">
        <div>
          <span>Prebuilt rows</span>
          <strong>{number(rows.length)}</strong>
        </div>
        <div>
          <span>Ready in bins</span>
          <strong>{number(readyCount)}</strong>
        </div>
        <div>
          <span>Needs bin check</span>
          <strong>{number(needsCheckCount)}</strong>
        </div>
        <div>
          <span>Missing env / letter</span>
          <strong>
            {number(missingEnvelopeCount)} / {number(missingLetterCount)}
          </strong>
        </div>
      </div>

      <div className="batch-actions" aria-label="Bin actions">
        <span>Update shown rows:</span>
        <button type="button" data-bin-mark="ready" onClick={() => onBulkMark("ready")}>
          Mark In Ashley Box + Stuffed
        </button>
        <button type="button" data-bin-mark="check" onClick={() => onBulkMark("check")}>
          Mark Needs Bin Check
        </button>
        <button type="button" data-bin-print="" onClick={onPrint}>
          Print Bin Checklist
        </button>
      </div>

      <div className="packet-grid bin-group-grid">
        {groups.length ? (
          groups.map((group) => <BinGroupCard group={group} key={group.label} />)
        ) : (
          <article className="packet-card">
            <h4>No prepaid rows</h4>
            <p>Nothing is expected in Ashley bins for this batch.</p>
          </article>
        )}
      </div>

      <div className="packet-section">
        <div className="panel-head packet-section-head">
          <div>
            <h3>Bin Row Checklist</h3>
            <p>Use this to verify each prebuilt piece is physically in the right dated bin.</p>
          </div>
          <span className="panel-count">{number(rows.length)} rows</span>
        </div>
        <div className="table-wrap">
          <table className="packet-table">
            <thead>
              <tr>
                <th>Ship Date</th>
                <th>Recipient</th>
                <th>Character</th>
                <th>Letter</th>
                <th>Bin Status</th>
                <th>Envelope</th>
                <th>Letter Status</th>
                <th>Location</th>
                <th>Bin</th>
                <th>Complete</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => <BinTableRow row={row} onFieldChange={onFieldChange} onCompleteWithPhoto={onCompleteWithPhoto} uploadState={uploadStates[mailingKey(row.mailing)]} key={mailingKey(row.mailing)} />)
              ) : (
                <tr>
                  <td colSpan={10} className="empty-state">
                    No Ashley bin rows for this batch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mobile-card-list bins-mobile-cards">
        <div className="ashley-work-head">
          <div><p className="section-label">Today&apos;s Work</p><h3>{rows.length ? `${rows.length} remaining` : "All done!"}</h3></div>
          <span>{proofs.length} completed photos</span>
        </div>
        {rows.map((row, index) => <BinMobileCard row={row} isNext={index === 0} onStart={onStart} onNeedsSomething={onNeedsSomething} onCompleteWithPhoto={onCompleteWithPhoto} uploadState={uploadStates[mailingKey(row.mailing)]} key={mailingKey(row.mailing)} />)}
        {!rows.length ? <div className="ashley-all-done"><strong>Batch Complete</strong><span>There are no letters left in this batch.</span></div> : null}
      </div>
      <ProofGallery proofs={proofs} title={batchDate ? `${formatDate(batchDate)} Mailing Photos` : "Recent Mailing Photos"} />
    </section>
  );
}

function BatchPhotoUpload({ batchDate, onBatchPhoto }: { batchDate: string; onBatchPhoto: BinsProps["onBatchPhoto"] }) {
  return (
    <section className="batch-photo-upload" aria-label="Batch envelope photo">
      <div><p className="section-label">Many envelopes at once</p><h4>Upload Batch Photo</h4><p>Lay out the envelopes, enter how many are visible, then take one clear photo.</p></div>
      <label><span>Envelopes visible</span><input type="number" min="1" max="30" defaultValue="8" data-batch-envelope-count /></label>
      <label className="complete-photo-button"><span>Take Batch Photo</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!batchDate} data-batch-mailing-photo onChange={async (event) => {
        const photo = event.currentTarget.files?.[0];
        const section = event.currentTarget.closest("section");
        const count = Number((section?.querySelector("[data-batch-envelope-count]") as HTMLInputElement | null)?.value) || 1;
        const resultNode = section?.querySelector("[data-batch-photo-result]");
        event.currentTarget.value = "";
        if (!photo) return;
        if (resultNode) resultNode.textContent = "Reading names…";
        try { const result = await onBatchPhoto(batchDate, count, photo); if (resultNode) resultNode.textContent = `${result.matched} matched automatically · ${result.needsReview} sent to Needs Review`; }
        catch (error) { if (resultNode) resultNode.textContent = error instanceof Error ? error.message : "Could not process the photo."; }
      }} /></label>
      {!batchDate ? <small>Choose a batch date first.</small> : null}
      <strong className="batch-photo-result" role="status" data-batch-photo-result />
    </section>
  );
}

function BinGroupCard({ group }: { group: BinGroup }) {
  return (
    <article className="packet-card bin-card">
      <h4>{group.label}</h4>
      <p>{number(group.total)} pieces expected in this dated bin group.</p>
      <div className="bin-card-counts">
        <div>
          <span>Confirmed</span>
          <strong>{number(group.ready)}</strong>
        </div>
        <div>
          <span>Check</span>
          <strong>{number(group.needsCheck)}</strong>
        </div>
      </div>
    </article>
  );
}

function BinTableRow({ row, onFieldChange, onCompleteWithPhoto, uploadState }: { row: BinRowData; onFieldChange: BinsProps["onFieldChange"]; onCompleteWithPhoto: BinsProps["onCompleteWithPhoto"]; uploadState?: MailingProofUploadState }) {
  const { mailing, status, bin, fieldValues } = row;
  return (
    <tr>
      <td>{formatDate(mailing.shipDate)}</td>
      <td>
        <strong>{mailing.recipientName}</strong>
        <span>{mailing.plan}</span>
      </td>
      <td>{mailing.character}</td>
      <td>{mailing.letterNumber}</td>
      <td>
        <span className={`pill status-${statusClass(status.label)}`}>{status.label}</span>
        <span>{status.detail}</span>
      </td>
      <td>
        <select
          className={`qa-select qa-${statusClass(fieldValues.envelope)}`}
          data-bin-select={`${mailingKey(mailing)}::field::envelope`}
          value={fieldValues.envelope}
          onChange={(event) => onFieldChange(mailing, "envelope", event.target.value)}
        >
          {COMPONENT_FIELD_OPTIONS.envelope.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </td>
      <td>
        <select
          className={`qa-select qa-${statusClass(fieldValues.letter)}`}
          data-bin-select={`${mailingKey(mailing)}::field::letter`}
          value={fieldValues.letter}
          onChange={(event) => onFieldChange(mailing, "letter", event.target.value)}
        >
          {COMPONENT_FIELD_OPTIONS.letter.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </td>
      <td>
        <select
          className={`qa-select qa-${statusClass(fieldValues.location)}`}
          data-bin-select={`${mailingKey(mailing)}::field::location`}
          value={fieldValues.location}
          onChange={(event) => onFieldChange(mailing, "location", event.target.value)}
        >
          {COMPONENT_FIELD_OPTIONS.location.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </td>
      <td>{bin}</td>
      <td><PhotoCapture mailing={mailing} onCompleteWithPhoto={onCompleteWithPhoto} uploadState={uploadState} /></td>
    </tr>
  );
}

function PhotoCapture({ mailing, onCompleteWithPhoto, uploadState }: { mailing: EffectiveMailing; onCompleteWithPhoto: BinsProps["onCompleteWithPhoto"]; uploadState?: MailingProofUploadState }) {
  return (
    <div className="photo-capture-action">
      <label className={`complete-photo-button ${uploadState?.busy ? "is-busy" : ""}`}>
        <span>{uploadState?.busy ? "Saving Photo…" : "Complete + Take Photo"}</span>
        <input type="file" accept="image/*" capture="environment" disabled={uploadState?.busy} data-mailing-proof={mailingKey(mailing)} onChange={(event) => {
          const photo = event.currentTarget.files?.[0];
          if (photo) onCompleteWithPhoto(mailing, photo);
          event.currentTarget.value = "";
        }} />
      </label>
      {uploadState?.error ? <small className="photo-upload-error" role="alert">{uploadState.error}</small> : null}
    </div>
  );
}

const QUICK_NEEDS = ["Needs stamp", "Missing artifact", "Missing letter", "Question for Marcy"];

function BinMobileCard({ row, isNext, onStart, onNeedsSomething, onCompleteWithPhoto, uploadState }: { row: BinRowData; isNext: boolean; onStart: BinsProps["onStart"]; onNeedsSomething: BinsProps["onNeedsSomething"]; onCompleteWithPhoto: BinsProps["onCompleteWithPhoto"]; uploadState?: MailingProofUploadState }) {
  return (
    <article className={`mobile-action-card bin-photo-card ${isNext ? "ashley-up-next" : ""}`}>
      {isNext ? <span className="ashley-next-label">Up next</span> : null}
      <div className="mobile-card-head"><div><strong>{row.mailing.recipientName}</strong><span>{row.mailing.character} · Letter {row.mailing.letterNumber}</span></div><span className={`pill status-${statusClass(row.status.label)}`}>{row.status.label}</span></div>
      <p>{formatDate(row.mailing.shipDate)} · {row.bin}</p>
      <div className="ashley-simple-actions">
        <button type="button" className="ashley-start-button" data-ashley-start={mailingKey(row.mailing)} onClick={() => onStart(row.mailing)}>{row.mailing.status === "Assembling" ? "In Progress" : "Start"}</button>
        <details className="ashley-needs-menu">
          <summary>Needs Something</summary>
          <div>
            {QUICK_NEEDS.map((need) => <button type="button" key={need} onClick={(event) => { onNeedsSomething(row.mailing, need); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{need}</button>)}
            <button type="button" className="ashley-clear-need" onClick={(event) => { onNeedsSomething(row.mailing, ""); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Clear note</button>
          </div>
        </details>
      </div>
      <PhotoCapture mailing={row.mailing} onCompleteWithPhoto={onCompleteWithPhoto} uploadState={uploadState} />
    </article>
  );
}
