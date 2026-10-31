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
}

export interface FulfillmentData {
  batchDate: string;
  printerDueDate: string;
  readyRows: FulfillmentRow[];
  heldRows: FulfillmentRow[];
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
  "Seraphine|10": "No extra item listed",
  "Seraphine|18": "No extra item listed",
};

export function printerSeriesName(mailing: Pick<EffectiveMailing, "character" | "notes">): string {
  if (mailing.character !== "Oliver") return mailing.character;
  return /\bnew oliver\b/i.test(mailing.notes || "") ? "Oliver - New" : "Oliver - Legacy";
}

export function printerAssemblyRule(seriesName: string, letterNumber: string | number): { inside: string; outside: string } | null {
  const letter = String(letterNumber);
  if (seriesName === "Legends") return { inside: `Printed insert/artifact: Journal Entry (${letter} Legends_A-4.5 x 6)`, outside: "No special envelope instruction listed" };
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
      const highIssues = exceptionsForMailing(mailing, seed, reviewed).filter((exception) => exception.severity === "High");
      const stopReasons = [
        ...highIssues.map((exception) => exception.reason),
        componentStatus(mailing, "payment", seed, reviewed, componentOverrides) !== "Active" ? "Payment is not active" : "",
        componentStatus(mailing, "qa", seed, reviewed, componentOverrides) === "Problem" ? "QA is marked Problem" : "",
        !mailing.shipDate ? "Mailing date is missing" : "",
        !folderUrl ? "Letter file is not attached/confirmed" : "",
        !assemblyRule ? "Printer assembly instructions are not confirmed" : "",
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
        insideInstructions: [assemblyRule?.inside || "", giftMessageFromNotes(mailing.notes) ? `Gift message: ${giftMessageFromNotes(mailing.notes)}` : "", !isBirthdayPostcard && renewalCardDue(mailing, seed) ? "Include renewal card" : ""].filter(Boolean).join("; "),
        outsideInstructions: assemblyRule?.outside || "",
        stopReasons,
      };
    });
  const readyRows = rows.filter((row) => row.stopReasons.length === 0);
  const heldRows = rows.filter((row) => row.stopReasons.length > 0);

  return {
    batchDate,
    printerDueDate: subtractCalendarDays(batchDate, 7),
    readyRows,
    heldRows,
  };
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
    "ENVELOPE / OUTSIDE": row.outsideInstructions,
    "IMPORTANT NOTES": [row.mailing.notes || "None", ...row.stopReasons.map((reason) => `STOP: ${reason}.`)].join(" "),
    Status: row.stopReasons.length ? "STOP" : "Ready",
  }));
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
  XLSX.writeFile(workbook, `EverLetter_${data.batchDate || "open"}_Printer_Fulfillment.xlsx`);
}
