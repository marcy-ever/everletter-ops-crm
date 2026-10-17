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
}

export interface FulfillmentData {
  batchDate: string;
  printerDueDate: string;
  readyRows: FulfillmentRow[];
  heldRows: EffectiveMailing[];
}

export interface FulfillmentSpreadsheetRow {
  "Mailing Date": string;
  "Recipient Name": string;
  "Mailing Address": string;
  Character: string;
  "Letter Number": string;
  "Envelope Type / Color": string;
  "Envelope Quantity": number;
  "Letter Folder": string;
  "Artifact / Extra": string;
  "Map / Insert": string;
  "Gift Message for Letter 1": string;
  "Renewal Card": string;
  "Special Instructions": string;
  "Order ID": string;
  "Mailing ID": string;
}

export type SubscriberScheduleRow = Record<string, string>;

export function subtractCalendarDays(isoDate: string, days: number): string {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
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
  const heldRows = candidates.filter((mailing) =>
    exceptionsForMailing(mailing, seed, reviewed).some((exception) => exception.severity === "High") ||
    componentStatus(mailing, "payment", seed, reviewed, componentOverrides) !== "Active" ||
    componentStatus(mailing, "qa", seed, reviewed, componentOverrides) === "Problem" ||
    !mailing.shipDate,
  );
  const heldIds = new Set(heldRows.map((mailing) => mailing.mailingId));
  const recipients = new Map(seed.recipients.map((recipient) => [recipient.recipientId, recipient]));

  const readyRows = candidates
    .filter((mailing) => !heldIds.has(mailing.mailingId))
    .map((mailing) => ({
      mailing,
      recipientAddress: recipients.get(mailing.recipientId)?.address || "",
      envelopeType: envelopeStockForCharacter(mailing.character),
      envelopeQuantity: envelopeQuantityForMailing(mailing),
      letterFolderUrl: letterFolderUrl(mailing),
      artifact: componentStatus(mailing, "artifact", seed, reviewed, componentOverrides),
      insert: componentStatus(mailing, "insert", seed, reviewed, componentOverrides),
      giftMessage: giftMessageFromNotes(mailing.notes),
      renewalCard: renewalCardDue(mailing, seed) ? "Include renewal card" : "",
    }));

  return {
    batchDate,
    printerDueDate: subtractCalendarDays(batchDate, 7),
    readyRows,
    heldRows,
  };
}

export function fulfillmentSpreadsheetRows(rows: FulfillmentRow[]): FulfillmentSpreadsheetRow[] {
  return rows.map((row) => ({
    "Mailing Date": row.mailing.shipDate,
    "Recipient Name": row.mailing.recipientName,
    "Mailing Address": row.recipientAddress,
    Character: row.mailing.character,
    "Letter Number": String(row.mailing.letterNumber),
    "Envelope Type / Color": row.envelopeType,
    "Envelope Quantity": row.envelopeQuantity,
    "Letter Folder": row.letterFolderUrl,
    "Artifact / Extra": row.artifact,
    "Map / Insert": row.insert,
    "Gift Message for Letter 1": row.giftMessage,
    "Renewal Card": row.renewalCard,
    "Special Instructions": row.mailing.notes,
    "Order ID": row.mailing.orderId,
    "Mailing ID": row.mailing.mailingId,
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
  const summary = XLSX.utils.aoa_to_sheet([
    ["Everletter Printer Fulfillment"],
    ["Mailing date", data.batchDate],
    ["Due to printer", data.printerDueDate],
    ["Ready mailings", data.readyRows.length],
    ["Held for review", data.heldRows.length],
  ]);
  const sheet = XLSX.utils.json_to_sheet(fulfillmentSpreadsheetRows(data.readyRows));
  sheet["!cols"] = [12, 28, 42, 16, 12, 24, 12, 42, 18, 18, 38, 22, 48, 16, 28].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, summary, "Batch Summary");
  XLSX.utils.book_append_sheet(workbook, sheet, "Fulfillment");
  XLSX.writeFile(workbook, `Everletter_Printer_Fulfillment_${data.batchDate || "all-open"}.xlsx`);
}
