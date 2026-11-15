import { useState } from "react";
import { formatDate } from "@/lib/domain/format";
import { FULFILLMENT_OWNERS, FULFILLMENT_STATUSES, LATE_ADDENDUM_STATUSES, type FulfillmentControl, type FulfillmentExportHistory } from "@/lib/domain/fulfillment";
import { number } from "../../format";
import { controlledFulfillmentRows, envelopeBatches, type ControlledFulfillmentRow, type EnvelopeBatch, type FulfillmentData, type PrinterDesignGroup } from "./fulfillment-selectors";

export interface PrinterFulfillmentProps {
  data: FulfillmentData;
  controls: Record<string, FulfillmentControl>;
  history: FulfillmentExportHistory[];
  loading: boolean;
  message: string;
  mainGroups: PrinterDesignGroup[];
  lateGroups: PrinterDesignGroup[];
  onControlChange: (row: ControlledFulfillmentRow, control: FulfillmentControl) => void;
  onExportGroup: (group: PrinterDesignGroup, batchName: string) => void;
  onDownloadProductionList: (batchName: string) => void;
  onDownloadSubscriberSchedule: () => void;
  onOpenEnvelopeBatch: (batch: EnvelopeBatch) => void;
}

export default function PrinterFulfillment(props: PrinterFulfillmentProps) {
  const { data, controls, history, loading, message, mainGroups, lateGroups, onControlChange, onExportGroup, onDownloadProductionList, onDownloadSubscriberSchedule, onOpenEnvelopeBatch } = props;
  const rows = controlledFulfillmentRows(data, controls);
  const batches = envelopeBatches([...mainGroups, ...lateGroups].flatMap((group) => group.rows));
  const [batchName, setBatchName] = useState(() => `${data.batchDate || "mailing"}_Fulfillment`);

  const patch = (row: ControlledFulfillmentRow, change: Partial<FulfillmentControl>) => onControlChange(row, { ...row.control, ...change });

  return (
    <section className="data-panel fulfillment-panel" aria-label="Printer fulfillment">
      <div className="panel-head"><div><h3>{data.batchDate ? `${formatDate(data.batchDate)} Printer Fulfillment` : "Printer Fulfillment"}</h3><p>Export one address spreadsheet per envelope design, plus one combined production list.</p></div><span className="panel-count">{number(mainGroups.reduce((sum, group) => sum + group.rows.length, 0))} main batch</span></div>
      <div className="print-summary fulfillment-summary">
        <div><span>Mailing date</span><strong>{data.batchDate ? formatDate(data.batchDate) : "Choose one batch"}</strong></div>
        <div><span>Send by</span><strong>{data.printerDueDate ? formatDate(data.printerDueDate) : "—"}</strong></div>
        <div><span>Main groups</span><strong>{mainGroups.length}</strong></div>
        <div><span>Late groups</span><strong>{lateGroups.length}</strong></div>
      </div>
      <div className="fulfillment-export-bar">
        <label>Batch name<input value={batchName} onChange={(event) => setBatchName(event.target.value)} /></label>
        <button type="button" onClick={() => onDownloadProductionList(batchName)} disabled={!data.batchDate || !batchName || !rows.length}>Download Combined Production List</button>
        <button type="button" onClick={onDownloadSubscriberSchedule}>Download Master Subscriber Schedule</button>
        {loading && <small>Loading saved controls…</small>}{message && <small>{message}</small>}
      </div>
      <DesignExports title="Main printer batch" groups={mainGroups} history={history} batchName={batchName} onExport={onExportGroup} />
      <DesignExports title="Late addendum" groups={lateGroups} history={history} batchName={batchName} onExport={onExportGroup} />
      <div className="batch-actions"><span>Addressed envelope PDFs:</span>{batches.length ? batches.map((batch) => <button type="button" key={batch.fileName} onClick={() => onOpenEnvelopeBatch(batch)}>{batch.seriesName} {batch.size} ({batch.rows.length})</button>) : <small>No printer-ready envelope batches yet.</small>}</div>
      <div className="table-wrap"><table className="packet-table fulfillment-table fulfillment-controls-table">
        <thead><tr><th>Recipient</th><th>Design / letter</th><th>Owner</th><th>Payment</th><th>Eligible</th><th>Exclude</th><th>Batch</th><th>Status</th><th>QC</th><th>Export history</th></tr></thead>
        <tbody>{rows.length ? rows.map((row) => <tr key={`${row.mailing.mailingId}:${row.mailing.sourceRow}`} className={row.exportStopReasons.length ? "fulfillment-stop-row" : ""}>
          <td><strong>{row.mailing.recipientName}</strong><span>{row.recipientAddress || "Address missing"}</span>{row.exportStopReasons.length > 0 && <em>{row.exportStopReasons.join("; ")}</em>}</td>
          <td>{row.seriesName}<span>Letter #{row.mailing.letterNumber} · {row.productionProfile?.envelopeSize || "Size missing"}</span></td>
          <td><select value={row.control.owner} onChange={(event) => patch(row, { owner: event.target.value as FulfillmentControl["owner"] })}>{FULFILLMENT_OWNERS.map((value) => <option key={value}>{value}</option>)}</select></td>
          <td><input aria-label={`Payment cleared for ${row.mailing.recipientName}`} type="checkbox" checked={row.control.paymentCleared} onChange={(event) => patch(row, { paymentCleared: event.target.checked })} /></td>
          <td><input aria-label={`Mailing eligible for ${row.mailing.recipientName}`} type="checkbox" checked={row.control.mailingEligible} onChange={(event) => patch(row, { mailingEligible: event.target.checked })} /></td>
          <td><input aria-label={`Exclude ${row.mailing.recipientName} from printer`} type="checkbox" checked={row.control.excludeFromPrinter} onChange={(event) => patch(row, { excludeFromPrinter: event.target.checked })} /></td>
          <td><select value={row.control.lateAddendumStatus} onChange={(event) => patch(row, { lateAddendumStatus: event.target.value as FulfillmentControl["lateAddendumStatus"] })}>{LATE_ADDENDUM_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></td>
          <td><select value={row.control.fulfillmentStatus} onChange={(event) => patch(row, { fulfillmentStatus: event.target.value as FulfillmentControl["fulfillmentStatus"] })}>{FULFILLMENT_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></td>
          <td><input className="qc-input" value={row.control.qcInitials} maxLength={12} onChange={(event) => patch(row, { qcInitials: event.target.value })} /></td>
          <td>{row.control.exportedDate ? <><strong>{row.control.batchName}</strong><span>{new Date(row.control.exportedDate).toLocaleDateString()}</span></> : "Not exported"}</td>
        </tr>) : <tr><td colSpan={10} className="empty-state">No fulfillment mailings in this batch.</td></tr>}</tbody>
      </table></div>
      {history.length > 0 && <div className="fulfillment-history"><strong>Archived exports</strong>{history.slice(0, 20).map((item) => <span key={item.id}>{item.batchName} · {item.designGroup} · {item.exportKind} · {item.rowCount} rows · {new Date(item.exportedAt).toLocaleString()}</span>)}</div>}
    </section>
  );
}

function DesignExports({ title, groups, history, batchName, onExport }: { title: string; groups: PrinterDesignGroup[]; history: FulfillmentExportHistory[]; batchName: string; onExport: (group: PrinterDesignGroup, batchName: string) => void }) {
  return <div className="fulfillment-design-groups"><strong>{title}</strong>{groups.length ? groups.map((group) => {
    const prior = history.filter((item) => item.designGroup === group.designGroup && item.exportKind === group.exportKind).length;
    return <button type="button" key={`${group.exportKind}:${group.designGroup}`} disabled={!batchName} onClick={() => onExport(group, batchName)}>{group.designGroup} ({group.rows.length}){prior ? ` · exported ${prior}×` : ""}</button>;
  }) : <small>No eligible recipients.</small>}</div>;
}
