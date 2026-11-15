export const FULFILLMENT_OWNERS = ["Printer", "EverLetter", "Hold"] as const;
export const LATE_ADDENDUM_STATUSES = ["Main", "Late addendum"] as const;
export const FULFILLMENT_STATUSES = ["Pending", "Exported", "In production", "Completed", "Hold"] as const;

export type FulfillmentOwner = (typeof FULFILLMENT_OWNERS)[number];
export type LateAddendumStatus = (typeof LATE_ADDENDUM_STATUSES)[number];
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export interface FulfillmentControl {
  owner: FulfillmentOwner;
  excludeFromPrinter: boolean;
  paymentCleared: boolean;
  mailingEligible: boolean;
  lateAddendumStatus: LateAddendumStatus;
  fulfillmentStatus: FulfillmentStatus;
  qcInitials: string;
  exportedDate: string;
  batchName: string;
}

export interface FulfillmentExportHistory {
  id: number;
  batchDate: string;
  batchName: string;
  exportKind: LateAddendumStatus;
  designGroup: string;
  rowCount: number;
  exportedAt: string;
  exportedBy: string | null;
}

export const DEFAULT_FULFILLMENT_CONTROL: FulfillmentControl = {
  owner: "Printer",
  excludeFromPrinter: false,
  paymentCleared: false,
  mailingEligible: true,
  lateAddendumStatus: "Main",
  fulfillmentStatus: "Pending",
  qcInitials: "",
  exportedDate: "",
  batchName: "",
};
