import type { Dataset } from "@/lib/domain/dataset";
import {
  componentStatus,
  effectiveMailings,
  exceptionsForMailing,
  giftMessageFromNotes,
  packetRows,
  renewalCardDue,
  selectedBatchDate,
  type EffectiveMailing,
} from "@/lib/client/selectors";
import { envelopeStockForCharacter } from "@/lib/domain/characters";
import { envelopeQuantityForMailing } from "@/lib/domain/plans";
import { DEFAULT_FULFILLMENT_CONTROL, type FulfillmentControl, type LateAddendumStatus } from "@/lib/domain/fulfillment";
import { fulfillmentControlKey } from "@/lib/client/fulfillment-client";
import {
  envelopeBatchFileName,
  productionProfileForSeries,
  UNIVERSAL_ASSEMBLY_STEPS,
  type EnvelopeSize,
  type SeriesProductionProfile,
} from "./fulfillment-rules";

export interface FulfillmentRow {
  mailing: EffectiveMailing;
  recipientAddress: string;
  envelopeType: string;
  envelopeQuantity: number;
  letterFolderUrl: string;
  artifact: string;
  insert: string;
  giftMessage: string;
  renewalCard: string;
  orderNumber: string;
  seriesName: string;
  letterFileName: string;
  insideInstructions: string;
  outsideInstructions: string;
  stopReasons: string[];
  cycleId: string;
  jobId: string;
  productionProfile: SeriesProductionProfile | null;
  envelopeBatchFileName: string;
  envelopeBatchPage: number;
  specialHandling: string;
  productionItem: string;
}

export interface FulfillmentData {
  batchDate: string;
  printerDueDate: string;
  readyRows: FulfillmentRow[];
  heldRows: FulfillmentRow[];
}

export interface ControlledFulfillmentRow extends FulfillmentRow {
  control: FulfillmentControl;
  exportStopReasons: string[];
}

export interface PrinterAddressRow {
  "Order ID": string;
  "Recipient Name": string;
  "Address Line 1": string;
  "Address Line 2": string;
  City: string;
  State: string;
  ZIP: string;
  Character: string;
  Version: string;
  "Letter Number": string;
  "Mail Date": string;
}

export interface PrinterDesignGroup {
  designGroup: string;
  batchDate: string;
  exportKind: LateAddendumStatus;
  rows: ControlledFulfillmentRow[];
}

export interface FulfillmentSpreadsheetRow {
  "Done?": string;
  "Order ID": string;
  "Mail To": string;
  "Series - USE EXACTLY": string;
  "Letter #": string;
  "Letter PDF": string;
  "PUT INSIDE": string;
  "ENVELOPE / OUTSIDE": string;
  "IMPORTANT NOTES": string;
  Status: "Ready" | "STOP";
}

export interface EnvelopeManifestRow {
  "Envelope PDF": string;
  Page: number;
  "Order ID": string;
  Recipient: string;
  "Series - USE EXACTLY": string;
  "Letter #": string;
  Address: string;
  "Envelope Size": EnvelopeSize | "";
  Font: string;
  Status: "Ready" | "STOP";
}

export interface ArtifactBatchRow {
  "Shared Production Item": string;
  Series: string;
  "Letter #": string;
  Quantity: number;
  "Master File": string;
  Status: "Ready" | "STOP";
}

export interface EnvelopeBatch {
  fileName: string;
  seriesName: string;
  size: EnvelopeSize;
  rows: FulfillmentRow[];
}

export interface CustomerJobRow {
  "Cycle ID": string;
  "Customer Job ID": string;
  "Order ID": string;
  Recipient: string;
  Address: string;
  "Series / Version": string;
  "Letter #": string;
  "Master Letter File": string;
  "Inner Envelope": string;
  "Outer Envelope": string;
  "Envelope Batch PDF": string;
  "Envelope Page": number | "";
  Postage: string;
  "Artifacts / Items": string;
  "Special Handling": string;
  Status: "Ready" | "STOP";
  "STOP Reasons": string;
}

export interface FulfillmentProductionRow {
  "Order ID": string;
  Recipient: string;
  Character: string;
  Version: string;
  "Letter Number": string;
  "Mail Date": string;
  "Letter File": string;
  "Artifact(s)": string;
  "Artifact Handling": string;
  "Inner Envelope": string;
  "Outer Envelope Size": EnvelopeSize | "";
  "Outer Artwork Filename": string;
  "USPS Stamp Category": string;
  "Glue Sticker": string;
  "Wax Seal": string;
  "Special Assembly Instructions": string;
  "Fulfillment Owner": string;
  "Fulfillment Status": string;
  "QC Initials": string;
  "Batch Name": string;
  "Exported Date": string;
  "Late Addendum": string;
  "STOP Reasons": string;
}

export type SubscriberScheduleRow = Record<string, string>;

export function subtractCalendarDays(isoDate: string, days: number): string {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const VERIFIED_INSIDE_RULES: Record<string, string> = {
  "Harper|10": "No extra item listed",
  "Harper|23": "No extra item listed",
  "Marigold|18": "No extra item listed",
  "Marley|5": "Add item: Leaf charm",
  "Marley|13": "No extra item listed",
  "Marley|16": "No extra item listed",
  "Oliver - Legacy|7": "No extra item listed",
  "Oliver - Legacy|10": "No extra item listed",
  "Oliver - Legacy|16": "No extra item listed",
  "Oliver - New|2": "No extra item listed",
  "Penelope|4": "No extra item listed",
  "Penelope|18": "No extra item listed",
  "Ringo|2": "Add item: Arrow charm",
  "Ringo|10": "Add item: Key wood charm",
  "Ringo|11": "Add item: Pawprint charm",
  "Seraphine|1": "Add printed artifact: Charcoal feather sketch",
  "Seraphine|10": "No extra item listed",
  "Seraphine|18": "No extra item listed",
};

export function printerSeriesName(mailing: Pick<EffectiveMailing, "character" | "notes">): string {
  if (mailing.character === "Old Marley") return "Marley - Legacy";
  if (mailing.character === "Gazette") return "Gazette";
  if (mailing.character === "New Oliver") return "Oliver - New";
  if (mailing.character === "Old Oliver") return "Oliver - Legacy";
  if (mailing.character !== "Oliver") return mailing.character;
  return /\bnew oliver\b/i.test(mailing.notes || "") ? "Oliver - New" : "Oliver - Legacy";
}

export function printerAssemblyRule(seriesName: string, letterNumber: string | number): { inside: string; outside: string } | null {
  const letter = String(letterNumber);
  if (seriesName === "Legends") return { inside: `Printed insert/artifact: Journal Entry (${letter} Legends_A-4.5 x 6)`, outside: "No special envelope instruction listed" };
  if (seriesName === "North Pole") return { inside: "Personalized North Pole letter using the child name, woodland-character version, and North Pole personalization in IMPORTANT NOTES", outside: "Use North Pole A9 artwork" };
  if (seriesName === "Birthday Postcard") return { inside: "Birthday postcard", outside: "Postcard — no envelope" };
  const inside = VERIFIED_INSIDE_RULES[`${seriesName}|${letter}`];
  if (!inside) return null;
  return { inside, outside: seriesName === "Ringo" ? "Inner: Yes/yellow" : "No special envelope instruction listed" };
}

export function printerLetterFileName(seriesName: string, letterNumber: string | number): string {
  if (seriesName === "Birthday Postcard") return "Birthday_Postcard_PRINT_READY.pdf";
  const base = seriesName.replace(/ - (New|Legacy)$/i, "").replace(/[^a-z0-9]+/gi, "_");
  return `${base}_Letter_${String(letterNumber).padStart(2, "0")}_PRINT_READY.pdf`;
}

function printerOrderId(orderId: string): string {
  return orderId.replace(/^(ORD-|SQ-)/i, "");
}

function mailTo(row: FulfillmentRow): string {
  const addressParts = row.recipientAddress.split(/\s*,\s*/).filter(Boolean);
  const address = addressParts.length >= 3
    ? [...addressParts.slice(0, -2), `${addressParts.at(-2)} ${addressParts.at(-1)}`].join("\n")
    : row.recipientAddress;
  return [row.mailing.recipientName, address].filter(Boolean).join("\n");
}

export function computeFulfillmentData(
  seed: Dataset,
  statusOverrides: Record<string, string>,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  batchFilter: string,
  query: string,
  today: string,
  letterFolderUrl: (mailing: EffectiveMailing) => string,
): FulfillmentData {
  const mailings = effectiveMailings(seed, statusOverrides);
  const batchDate = selectedBatchDate(batchFilter, mailings, today);
  const candidates = packetRows(mailings, batchDate, "all", query);
  const recipients = new Map(seed.recipients.map((recipient) => [recipient.recipientId, recipient]));
  const orders = new Map(seed.orders.map((order) => [order.orderId, order]));

  const rows = candidates.map((mailing) => {
      const isBirthdayPostcard = mailing.character === "Birthday Postcard";
      const folderUrl = letterFolderUrl(mailing);
      const seriesName = printerSeriesName(mailing);
      const assemblyRule = printerAssemblyRule(seriesName, mailing.letterNumber);
      const artifactSourcePending = seriesName === "Seraphine" && String(mailing.letterNumber) === "1";
      const productionProfile = productionProfileForSeries(seriesName);
      const highIssues = exceptionsForMailing(mailing, seed, reviewed).filter((exception) => exception.severity === "High");
      const stopReasons = [
        ...highIssues.map((exception) => exception.reason),
        componentStatus(mailing, "payment", seed, reviewed, componentOverrides) !== "Active" ? "Payment is not active" : "",
        componentStatus(mailing, "qa", seed, reviewed, componentOverrides) === "Problem" ? "QA is marked Problem" : "",
        !mailing.shipDate ? "Mailing date is missing" : "",
        !folderUrl ? "Letter file is not attached/confirmed" : "",
        !assemblyRule ? "Printer assembly instructions are not confirmed" : "",
        artifactSourcePending ? "Seraphine Letter 1 feather-sketch print file is not attached/confirmed" : "",
        !productionProfile ? "Envelope production profile is not confirmed" : "",
        productionProfile && !productionProfile.fontConfirmed ? `${seriesName} envelope font is pending Marcy selection` : "",
        productionProfile?.innerEnvelope.startsWith("HOLD / STOP") ? `${seriesName} inner-envelope color is not confirmed` : "",
      ].filter(Boolean);
      return {
        mailing,
        recipientAddress: recipients.get(mailing.recipientId)?.address || "",
        envelopeType: envelopeStockForCharacter(mailing.character),
        envelopeQuantity: isBirthdayPostcard ? 0 : envelopeQuantityForMailing(mailing),
        letterFolderUrl: folderUrl,
        artifact: isBirthdayPostcard ? "Not needed" : componentStatus(mailing, "artifact", seed, reviewed, componentOverrides),
        insert: isBirthdayPostcard ? "Birthday postcard" : componentStatus(mailing, "insert", seed, reviewed, componentOverrides),
        giftMessage: giftMessageFromNotes(mailing.notes),
        renewalCard: isBirthdayPostcard ? "" : renewalCardDue(mailing, seed) ? "Include renewal card" : "",
        orderNumber: orders.get(mailing.orderId)?.sourceOrderNumber || printerOrderId(mailing.orderId),
        seriesName,
        letterFileName: folderUrl ? printerLetterFileName(seriesName, mailing.letterNumber) : "",
        insideInstructions: [
          !isBirthdayPostcard && productionProfile ? `Fold exact letter into ${productionProfile.innerEnvelope}; leave inner envelope BLANK and UNSEALED` : "",
          assemblyRule?.inside || "",
          giftMessageFromNotes(mailing.notes) ? `Gift message: ${giftMessageFromNotes(mailing.notes)}` : "",
          !isBirthdayPostcard && renewalCardDue(mailing, seed) ? "Include renewal card" : "",
        ].filter(Boolean).join("; "),
        outsideInstructions: assemblyRule?.outside || "",
        stopReasons,
        cycleId: batchDate,
        jobId: `${batchDate}::${mailing.mailingId}`,
        productionProfile,
        envelopeBatchFileName: productionProfile && productionProfile.envelopeSize !== "POSTCARD" ? envelopeBatchFileName(batchDate, productionProfile) : "",
        envelopeBatchPage: 0,
        specialHandling: mailing.notes || "",
        productionItem: assemblyRule?.inside || "",
      };
    });
  const pageByBatch = new Map<string, number>();
  for (const row of rows.sort((a, b) => a.envelopeBatchFileName.localeCompare(b.envelopeBatchFileName) || a.mailing.recipientName.localeCompare(b.mailing.recipientName))) {
    if (!row.envelopeBatchFileName) continue;
    const page = (pageByBatch.get(row.envelopeBatchFileName) || 0) + 1;
    pageByBatch.set(row.envelopeBatchFileName, page);
    row.envelopeBatchPage = page;
  }
  const readyRows = rows.filter((row) => row.stopReasons.length === 0);
  const heldRows = rows.filter((row) => row.stopReasons.length > 0);

  return {
    batchDate,
    printerDueDate: subtractCalendarDays(batchDate, 7),
    readyRows,
    heldRows,
  };
}

export function fulfillmentControlForRow(row: FulfillmentRow, controls: Record<string, FulfillmentControl>): FulfillmentControl {
  const saved = controls[fulfillmentControlKey(row.mailing.mailingId, row.mailing.sourceRow)];
  if (saved) return saved;
  return {
    ...DEFAULT_FULFILLMENT_CONTROL,
    paymentCleared: !row.stopReasons.includes("Payment is not active"),
    mailingEligible: row.mailing.activeState === "Active" && Boolean(row.mailing.shipDate),
  };
}

export function controlledFulfillmentRows(data: FulfillmentData, controls: Record<string, FulfillmentControl>): ControlledFulfillmentRow[] {
  return [...data.readyRows, ...data.heldRows].map((row) => {
    const control = fulfillmentControlForRow(row, controls);
    const exportStopReasons = row.stopReasons.filter((reason) => reason !== "Payment is not active" || !control.paymentCleared);
    if (control.owner !== "Printer") exportStopReasons.push(`Fulfillment owner is ${control.owner}`);
    if (control.excludeFromPrinter) exportStopReasons.push("Excluded from printer export");
    if (!control.paymentCleared) exportStopReasons.push("Payment has not cleared");
    if (!control.mailingEligible) exportStopReasons.push("Mailing is not eligible");
    return { ...row, control, exportStopReasons: [...new Set(exportStopReasons)] };
  });
}

export function printerDesignGroupForRow(row: FulfillmentRow): string {
  const profile = row.productionProfile;
  const series = row.seriesName.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  return `${series}_${profile?.envelopeSize || "UNKNOWN"}`;
}

export function printerDesignGroups(data: FulfillmentData, controls: Record<string, FulfillmentControl>, exportKind: LateAddendumStatus): PrinterDesignGroup[] {
  const groups = new Map<string, ControlledFulfillmentRow[]>();
  for (const row of controlledFulfillmentRows(data, controls)) {
    if (row.control.lateAddendumStatus !== exportKind || row.exportStopReasons.length) continue;
    const key = printerDesignGroupForRow(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([designGroup, rows]) => ({ designGroup, batchDate: data.batchDate, exportKind, rows: rows.sort((a, b) => a.mailing.recipientName.localeCompare(b.mailing.recipientName)) })).sort((a, b) => a.designGroup.localeCompare(b.designGroup));
}

export function splitPrinterAddress(address: string): { line1: string; line2: string; city: string; state: string; zip: string } {
  const parts = address.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
  const stateZip = parts.pop() || "";
  const city = parts.pop() || "";
  const stateZipMatch = stateZip.match(/^([A-Za-z]{2})\s+(.+)$/);
  const line1 = parts.shift() || "";
  return { line1, line2: parts.join(", "), city, state: stateZipMatch?.[1]?.toUpperCase() || stateZip, zip: stateZipMatch?.[2] || "" };
}

export function printerAddressRows(group: PrinterDesignGroup): PrinterAddressRow[] {
  return group.rows.map((row) => {
    const address = splitPrinterAddress(row.recipientAddress);
    const [character, defaultVersion = "Standard"] = row.seriesName.split(/\s+-\s+/, 2);
    const northPoleVersion = row.mailing.notes.match(/PREFERRED WOODLAND CHARACTER:\s*([^;]+)/i)?.[1]?.trim();
    const version = row.seriesName === "North Pole" && northPoleVersion ? northPoleVersion : defaultVersion;
    return {
      "Order ID": row.orderNumber,
      "Recipient Name": row.mailing.recipientName,
      "Address Line 1": address.line1,
      "Address Line 2": address.line2,
      City: address.city,
      State: address.state,
      ZIP: address.zip,
      Character: character,
      Version: version,
      "Letter Number": String(row.mailing.letterNumber),
      "Mail Date": row.mailing.shipDate,
    };
  });
}

export async function downloadPrinterDesignWorkbook(group: PrinterDesignGroup, batchName: string): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(printerAddressRows(group));
  sheet["!cols"] = [14, 28, 34, 24, 22, 10, 12, 18, 16, 14, 14].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:K${Math.max(group.rows.length + 1, 1)}` };
  sheet["!freeze"] = { ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, sheet, "ADDRESSES");
  const instructions = XLSX.utils.aoa_to_sheet([["Printer address font", "Arial"], ["Artwork/design", group.designGroup], ["Mail date", group.batchDate], ["Batch type", group.exportKind]]);
  instructions["!cols"] = [{ wch: 24 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, instructions, "INSTRUCTIONS");
  const kind = group.exportKind === "Late addendum" ? "LATE_ADDENDUM" : "MAIN";
  XLSX.writeFile(workbook, `${batchName}_${kind}_${group.designGroup}.xlsx`);
}

export function fulfillmentSpreadsheetRows(rows: FulfillmentRow[]): FulfillmentSpreadsheetRow[] {
  return rows.map((row) => ({
    "Done?": "No",
    "Order ID": row.orderNumber,
    "Mail To": mailTo(row),
    "Series - USE EXACTLY": row.seriesName,
    "Letter #": row.mailing.character === "Birthday Postcard" ? "Birthday postcard" : String(row.mailing.letterNumber),
    "Letter PDF": row.letterFileName,
    "PUT INSIDE": row.insideInstructions,
    "ENVELOPE / OUTSIDE": row.productionProfile
      ? `${row.productionProfile.outerEnvelope}; ${row.productionProfile.postage}; glue/protective sticker + wax seal on OUTER envelope; ${row.envelopeBatchFileName ? `${row.envelopeBatchFileName} page ${row.envelopeBatchPage}` : row.outsideInstructions}`
      : row.outsideInstructions,
    "IMPORTANT NOTES": [row.mailing.notes || "None", ...row.stopReasons.map((reason) => `STOP: ${reason}.`)].join(" "),
    Status: row.stopReasons.length ? "STOP" : "Ready",
  }));
}

export function envelopeManifestRows(rows: FulfillmentRow[]): EnvelopeManifestRow[] {
  return rows.filter((row) => row.envelopeBatchFileName).map((row) => ({
    "Envelope PDF": row.envelopeBatchFileName,
    Page: row.envelopeBatchPage,
    "Order ID": row.orderNumber,
    Recipient: row.mailing.recipientName,
    "Series - USE EXACTLY": row.seriesName,
    "Letter #": String(row.mailing.letterNumber),
    Address: row.recipientAddress,
    "Envelope Size": row.productionProfile?.envelopeSize || "",
    Font: row.productionProfile?.fontFamily || "",
    Status: row.stopReasons.length ? "STOP" : "Ready",
  }));
}

export function envelopeBatches(rows: FulfillmentRow[]): EnvelopeBatch[] {
  const groups = new Map<string, EnvelopeBatch>();
  for (const row of rows) {
    if (!row.envelopeBatchFileName || !row.productionProfile || row.stopReasons.length) continue;
    const existing = groups.get(row.envelopeBatchFileName);
    if (existing) existing.rows.push(row);
    else groups.set(row.envelopeBatchFileName, {
      fileName: row.envelopeBatchFileName,
      seriesName: row.seriesName,
      size: row.productionProfile.envelopeSize,
      rows: [row],
    });
  }
  return [...groups.values()].sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export function customerJobRows(rows: FulfillmentRow[]): CustomerJobRow[] {
  return rows.map((row) => ({
    "Cycle ID": row.cycleId,
    "Customer Job ID": row.jobId,
    "Order ID": row.orderNumber,
    Recipient: row.mailing.recipientName,
    Address: row.recipientAddress,
    "Series / Version": row.seriesName,
    "Letter #": String(row.mailing.letterNumber),
    "Master Letter File": row.letterFileName,
    "Inner Envelope": row.productionProfile?.innerEnvelope || "HOLD / STOP - CONFIRM",
    "Outer Envelope": row.productionProfile?.outerEnvelope || "HOLD / STOP - CONFIRM",
    "Envelope Batch PDF": row.envelopeBatchFileName,
    "Envelope Page": row.envelopeBatchPage || "",
    Postage: row.productionProfile?.postage || "HOLD / STOP - CONFIRM",
    "Artifacts / Items": row.productionItem || "None listed",
    "Special Handling": row.specialHandling,
    Status: row.stopReasons.length ? "STOP" : "Ready",
    "STOP Reasons": row.stopReasons.join("; "),
  }));
}

function artworkFilename(row: FulfillmentRow): string {
  const size = row.productionProfile?.envelopeSize || "UNKNOWN";
  const series = row.seriesName.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  return `${series}_${size}_OUTER_ARTWORK.pdf`;
}

export function fulfillmentProductionRows(data: FulfillmentData, controls: Record<string, FulfillmentControl>, batchName: string): FulfillmentProductionRow[] {
  return controlledFulfillmentRows(data, controls).map((row) => {
    const [character, version = "Standard"] = row.seriesName.split(/\s+-\s+/, 2);
    return {
      "Order ID": row.orderNumber,
      Recipient: row.mailing.recipientName,
      Character: character,
      Version: version,
      "Letter Number": String(row.mailing.letterNumber),
      "Mail Date": row.mailing.shipDate,
      "Letter File": row.letterFileName,
      "Artifact(s)": row.productionItem || "None listed",
      "Artifact Handling": row.productionItem.startsWith("Printed") ? "Print once in shared batch; insert one per recipient" : row.productionItem.startsWith("Add item") ? "Pull from inventory; insert one" : "None",
      "Inner Envelope": row.productionProfile?.innerEnvelope || "HOLD / STOP - CONFIRM",
      "Outer Envelope Size": row.productionProfile?.envelopeSize || "",
      "Outer Artwork Filename": artworkFilename(row),
      "USPS Stamp Category": row.productionProfile?.postage || "HOLD / STOP - CONFIRM",
      "Glue Sticker": "Required on outer envelope",
      "Wax Seal": "Required on outer envelope over glue sticker",
      "Special Assembly Instructions": row.insideInstructions,
      "Fulfillment Owner": row.control.owner,
      "Fulfillment Status": row.control.fulfillmentStatus,
      "QC Initials": row.control.qcInitials,
      "Batch Name": row.control.batchName || batchName,
      "Exported Date": row.control.exportedDate,
      "Late Addendum": row.control.lateAddendumStatus,
      "STOP Reasons": row.exportStopReasons.join("; "),
    };
  });
}

export async function downloadFulfillmentProductionList(data: FulfillmentData, controls: Record<string, FulfillmentControl>, batchName: string): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const rows = fulfillmentProductionRows(data, controls, batchName);
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [14, 28, 18, 16, 12, 14, 34, 38, 36, 34, 16, 34, 22, 24, 34, 48, 18, 20, 14, 26, 22, 16, 52].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:W${Math.max(rows.length + 1, 1)}` };
  sheet["!freeze"] = { ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, sheet, "FULFILLMENT PRODUCTION");
  XLSX.writeFile(workbook, `${batchName}_FULFILLMENT_PRODUCTION.xlsx`);
}

export function artifactBatchRows(rows: FulfillmentRow[]): ArtifactBatchRow[] {
  const groups = new Map<string, ArtifactBatchRow>();
  for (const row of rows) {
    const item = row.productionItem.trim();
    if (!item || item === "No extra item listed") continue;
    const key = `${row.seriesName}|${row.mailing.letterNumber}|${item}`;
    const existing = groups.get(key);
    if (existing) {
      existing.Quantity += 1;
      if (row.stopReasons.length) existing.Status = "STOP";
      continue;
    }
    groups.set(key, {
      "Shared Production Item": item,
      Series: row.seriesName,
      "Letter #": String(row.mailing.letterNumber),
      Quantity: 1,
      "Master File": item.startsWith("Printed insert/artifact:") ? item.replace(/^Printed insert\/artifact:\s*/, "") : "Physical inventory item",
      Status: row.stopReasons.length ? "STOP" : "Ready",
    });
  }
  return [...groups.values()].sort((a, b) => a.Series.localeCompare(b.Series) || Number(a["Letter #"]) - Number(b["Letter #"]));
}

export function subscriberScheduleRows(seed: Dataset, statusOverrides: Record<string, string>): SubscriberScheduleRow[] {
  const mailings = effectiveMailings(seed, statusOverrides);
  const subscribers = new Map(seed.subscribers.map((subscriber) => [subscriber.subscriberId, subscriber]));
  const recipients = new Map(seed.recipients.map((recipient) => [recipient.recipientId, recipient]));

  return seed.subscriptions
    .map((subscription) => {
      const subscriber = subscribers.get(subscription.subscriberId);
      const recipient = recipients.get(subscription.recipientId);
      const subscriptionMailings = mailings
        .filter((mailing) => mailing.subscriptionId === subscription.subscriptionId)
        .sort((a, b) => Number(a.letterNumber) - Number(b.letterNumber));
      const row: SubscriberScheduleRow = {
        "Plan": subscription.plan,
        "Customer Name": subscriber?.displayName || "",
        "Customer Email": subscriber?.email || "",
        "Recipient Name": recipient?.name || subscriptionMailings[0]?.recipientName || "",
        "Mailing Address": recipient?.address || "",
        "Character": subscription.character,
        "Subscription Start": subscription.startDate,
        "Subscription End": subscription.endDate,
        "Active": subscription.activeState,
      };

      for (let letter = 1; letter <= 24; letter += 1) {
        const mailing = subscriptionMailings.find((item) => Number(item.letterNumber) === letter);
        row[`L${letter}`] = mailing ? (mailing.status === "Mailed" ? "Mailed" : mailing.shipDate || mailing.status) : "";
      }
      return row;
    })
    .sort((a, b) => a["Recipient Name"].localeCompare(b["Recipient Name"]) || a.Character.localeCompare(b.Character));
}

export async function downloadSubscriberScheduleWorkbook(seed: Dataset, statusOverrides: Record<string, string>): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const rows = subscriberScheduleRows(seed, statusOverrides);
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [16, 24, 30, 28, 42, 16, 16, 16, 12, ...Array.from({ length: 24 }, () => 13)].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:AG${Math.max(rows.length + 1, 1)}` };
  sheet["!freeze"] = { xSplit: 6, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, sheet, "Subscriber Schedule");
  XLSX.writeFile(workbook, `Everletter_Master_Subscriber_Schedule_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function downloadFulfillmentWorkbook(data: FulfillmentData): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const allRows = [...data.readyRows, ...data.heldRows];
  const titleDate = data.batchDate ? new Date(`${data.batchDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).toUpperCase() : "OPEN MAILINGS";
  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_json(sheet, fulfillmentSpreadsheetRows(allRows), { origin: "A5" });
  XLSX.utils.sheet_add_aoa(sheet, [
    [`EVERLETTER - ${titleDate} PRINTER FULFILLMENT`],
    [`${allRows.length} total rows: ${data.readyRows.length} ready to send and ${data.heldRows.length} STOP row${data.heldRows.length === 1 ? "" : "s"} awaiting review. Each row is one envelope.`],
    ["Ashley: check only that the recipient, series and letter number look right. The printer uses the remaining columns to assemble each envelope."],
  ], { origin: "A1" });
  sheet["!merges"] = [XLSX.utils.decode_range("A1:J1"), XLSX.utils.decode_range("A2:J2"), XLSX.utils.decode_range("A3:J3")];
  sheet["!cols"] = [9, 12, 38, 22, 10, 32, 46, 34, 58, 12].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A5:J${Math.max(allRows.length + 5, 5)}` };
  sheet["!freeze"] = { ySplit: 5 };
  XLSX.utils.book_append_sheet(workbook, sheet, "SEND TO PRINTER");

  const jobs = XLSX.utils.json_to_sheet(customerJobRows(allRows));
  jobs["!cols"] = [14, 36, 13, 28, 42, 22, 10, 34, 32, 30, 38, 12, 20, 42, 52, 12, 54].map((wch) => ({ wch }));
  jobs["!autofilter"] = { ref: `A1:Q${Math.max(allRows.length + 1, 1)}` };
  jobs["!freeze"] = { ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, jobs, "CUSTOMER JOBS");

  const manifest = XLSX.utils.json_to_sheet(envelopeManifestRows(allRows));
  manifest["!cols"] = [38, 8, 13, 28, 22, 10, 42, 14, 22, 12].map((wch) => ({ wch }));
  manifest["!autofilter"] = { ref: `A1:J${Math.max(allRows.length + 1, 1)}` };
  manifest["!freeze"] = { ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, manifest, "ENVELOPE MANIFEST");

  const artifacts = artifactBatchRows(allRows);
  const artifactSheet = XLSX.utils.json_to_sheet(artifacts);
  artifactSheet["!cols"] = [48, 22, 10, 12, 42, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, artifactSheet, "SHARED ARTIFACT BATCHES");

  const instructions = XLSX.utils.aoa_to_sheet([
    ["EVERLETTER UNIVERSAL ASSEMBLY INSTRUCTIONS"],
    ...UNIVERSAL_ASSEMBLY_STEPS.map((step, index) => [`${index + 1}. ${step}`]),
    [],
    ["IMPORTANT", "The inner envelope stays blank and unsealed. Postage, glue/protective sticker, and wax seal belong on the OUTER envelope."],
  ]);
  instructions["!cols"] = [{ wch: 105 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, instructions, "UNIVERSAL INSTRUCTIONS");
  XLSX.writeFile(workbook, `EverLetter_${data.batchDate || "open"}_Printer_Fulfillment.xlsx`);
}
