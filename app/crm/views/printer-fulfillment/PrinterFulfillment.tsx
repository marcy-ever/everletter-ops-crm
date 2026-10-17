import { formatDate } from "@/lib/domain/format";
import { number } from "../../format";
import type { FulfillmentData } from "./fulfillment-selectors";

export interface PrinterFulfillmentProps {
  data: FulfillmentData;
  onDownload: () => void;
  onDownloadSubscriberSchedule: () => void;
}

export default function PrinterFulfillment({ data, onDownload, onDownloadSubscriberSchedule }: PrinterFulfillmentProps) {
  return (
    <section className="data-panel fulfillment-panel" aria-label="Printer fulfillment">
      <div className="panel-head">
        <div>
          <h3>{data.batchDate ? `${formatDate(data.batchDate)} Printer Fulfillment` : "Printer Fulfillment"}</h3>
          <p>Review exactly what the printer should put in every envelope, then download the spreadsheet.</p>
        </div>
        <span className="panel-count">{number(data.readyRows.length)} ready</span>
      </div>

      <div className="print-summary fulfillment-summary">
        <div><span>Mailing date</span><strong>{data.batchDate ? formatDate(data.batchDate) : "All open"}</strong></div>
        <div><span>Send to printer by</span><strong>{data.printerDueDate ? formatDate(data.printerDueDate) : "Choose one batch"}</strong></div>
        <div><span>Ready rows</span><strong>{number(data.readyRows.length)}</strong></div>
        <div><span>Held for review</span><strong>{number(data.heldRows.length)}</strong></div>
      </div>

      <div className="batch-actions">
        <span>Printer file:</span>
        <button type="button" className="primary-action" disabled={!data.batchDate || !data.readyRows.length} onClick={onDownload}>
          Download Printer Spreadsheet
        </button>
        <button type="button" onClick={onDownloadSubscriberSchedule}>Download Master Subscriber Schedule</button>
        <small>High-risk rows are held back automatically.</small>
      </div>

      <div className="table-wrap">
        <table className="packet-table fulfillment-table">
          <thead><tr><th>Recipient / mailing address</th><th>Character</th><th>Letter</th><th>Envelope</th><th>What goes inside</th><th>Special instructions</th></tr></thead>
          <tbody>
            {data.readyRows.length ? data.readyRows.map((row) => (
              <tr key={row.mailing.mailingId}>
                <td><strong>{row.mailing.recipientName}</strong><span>{row.recipientAddress || "Address missing"}</span></td>
                <td>{row.mailing.character}</td>
                <td>#{row.mailing.letterNumber}</td>
                <td>{row.envelopeType}<span>Qty {row.envelopeQuantity}</span></td>
                <td>
                  <span>Artifact: {row.artifact}</span>
                  <span>Insert: {row.insert}</span>
                  {row.renewalCard && <strong>{row.renewalCard}</strong>}
                  {row.giftMessage && <strong>Gift message: {row.giftMessage}</strong>}
                </td>
                <td>{row.mailing.notes || "—"}</td>
              </tr>
            )) : <tr><td colSpan={6} className="empty-state">No printer-ready mailings in this batch.</td></tr>}
          </tbody>
        </table>
      </div>

      {data.heldRows.length > 0 && (
        <div className="fulfillment-held">
          <strong>{data.heldRows.length} row{data.heldRows.length === 1 ? " is" : "s are"} held for Needs Review.</strong>
          <span>They are not included in the downloaded printer spreadsheet.</span>
        </div>
      )}
    </section>
  );
}
