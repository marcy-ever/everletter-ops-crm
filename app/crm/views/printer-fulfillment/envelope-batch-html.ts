import { escapeHtml } from "../../format";
import type { EnvelopeBatch, FulfillmentRow } from "./fulfillment-selectors";
import { DEFAULT_PRINTER_OUTPUT_SETTINGS, type PrinterOutputSettings } from "./fulfillment-rules";

function addressLines(address: string): string[] {
  const parts = address.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 3) return [parts.slice(0, -2).join(", "), `${parts.at(-2)}, ${parts.at(-1)}`];
  return parts.length ? parts : ["Missing address"];
}

function fontSizeClass(row: FulfillmentRow): string {
  const longest = Math.max(row.mailing.recipientName.length, ...addressLines(row.recipientAddress).map((line) => line.length));
  if (longest > 46) return "address-long";
  if (longest > 34) return "address-medium";
  return "";
}

export function fulfillmentEnvelopeBatchHtml(batch: EnvelopeBatch, settings: PrinterOutputSettings = DEFAULT_PRINTER_OUTPUT_SETTINGS): string {
  const width = batch.size === "A9" ? settings.a9WidthIn : settings.a7WidthIn;
  const height = batch.size === "A9" ? settings.a9HeightIn : settings.a7HeightIn;
  const pages = batch.rows.map((row) => {
    const lines = addressLines(row.recipientAddress);
    return `<section class="envelope-page ${fontSizeClass(row)}">
      <div class="mail-to" style="--address-font:'${escapeHtml(row.productionProfile?.fontFamily || "serif")}'">
        <strong>${escapeHtml(row.mailing.recipientName)}</strong>
        ${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
      </div>
      <div class="production-meta">${escapeHtml(batch.fileName)} · Page ${row.envelopeBatchPage} · ${escapeHtml(row.orderNumber)}</div>
    </section>`;
  }).join("");
  return `<!doctype html><html><head><title>${escapeHtml(batch.fileName)}</title><style>
    @import url('https://fonts.googleapis.com/css2?family=Anonymous+Pro&family=Caveat&family=Dancing+Script&family=Gloria+Hallelujah&family=Quicksand:wght@400;500;600&family=Schoolbell&display=swap');
    @page { size: ${width}in ${height}in; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .envelope-page { position: relative; width: ${width}in; height: ${height}in; page-break-after: always; background: white; overflow: hidden; }
    .mail-to { position: absolute; top: 55%; left: 19%; width: 63%; text-align: center; color: #312820; font-family: var(--address-font), serif; line-height: 1.24; }
    .mail-to strong, .mail-to span { display: block; }
    .mail-to strong { margin-bottom: .08in; font-size: 22pt; font-weight: 500; }
    .mail-to span { font-size: 15pt; }
    .address-medium .mail-to strong { font-size: 18pt; } .address-medium .mail-to span { font-size: 13pt; }
    .address-long .mail-to strong { font-size: 15pt; } .address-long .mail-to span { font-size: 11pt; }
    .production-meta { display: none; }
    @media screen { body { background: #eee8df; padding: 24px; } .envelope-page { margin: 0 auto 24px; box-shadow: 0 8px 28px #0002; } .production-meta { display: block; position: absolute; bottom: 4px; right: 8px; font: 8px Arial; color: #aaa; } }
  </style></head><body>${pages}</body></html>`;
}

export function openFulfillmentEnvelopeBatch(batch: EnvelopeBatch): void {
  const popup = window.open("", "_blank");
  if (!popup) { alert("Popup blocked. Allow popups, then try again."); return; }
  popup.document.open();
  popup.document.write(fulfillmentEnvelopeBatchHtml(batch));
  popup.document.close();
}
