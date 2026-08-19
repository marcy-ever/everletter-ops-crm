/**
 * The CRM dataset shape: subscribers, recipients, orders, subscriptions,
 * mailings, exceptions, a summary, and automation-rules text. Produced two
 * ways - client-side, by parsing an uploaded spreadsheet
 * (lib/domain/spreadsheet/build-seed.ts's buildSeedFromSpreadsheet), and
 * server-side, by reconstructing from the normalized tables
 * (lib/build-dataset-from-tables.ts's buildDatasetFromTables) - and both
 * are required to produce this same shape exactly, which is the whole
 * premise tests/build-dataset-from-tables.e2e.test.mjs exists to verify.
 * One canonical definition here means that equivalence is enforced by the
 * type system, not just by a runtime diff.
 */

export interface DatasetSubscriber {
  subscriberId: string;
  email: string;
  displayName: string;
  status: string;
  firstOrderDate: string;
  openMailings: number;
  totalMailings: number;
  nextShipDate: string;
  issueCount: number;
}

export interface DatasetRecipient {
  recipientId: string;
  subscriberId: string;
  name: string;
  address: string;
  characters: string[];
  totalMailings: number;
  nextShipDate: string;
}

export interface DatasetOrder {
  orderId: string;
  subscriberId: string;
  sourceOrderNumber: string;
  createdOn: string;
  billingMonth: string;
  plan: string;
  status: string;
  amount: string;
}

export interface DatasetSubscription {
  subscriptionId: string;
  subscriberId: string;
  recipientId: string;
  plan: string;
  character: string;
  startDate: string;
  endDate: string;
  activeState: string;
  generatedMailings: number;
}

export interface DatasetMailing {
  mailingId: string;
  subscriberId: string;
  recipientId: string;
  orderId: string;
  orderDate: string;
  subscriptionId: string;
  recipientName: string;
  email: string;
  character: string;
  plan: string;
  letterNumber: string;
  shipDate: string;
  suggestedShipDate: string;
  status: string;
  activeState: string;
  notes: string;
  overdue: boolean;
  dueNext14Days: boolean;
  sourceRow: number;
}

export interface DatasetException {
  exceptionId: string;
  severity: "High" | "Low";
  reason: string;
  mailingId: string;
  subscriberId: string;
  recipientName: string;
  shipDate: string;
  suggestedShipDate: string;
  status: string;
  // null for the server-reconstructed "subscription-only fallback" case
  // (lib/build-dataset-from-tables.ts's buildExceptions()) - the row
  // number is genuinely unrecoverable there. The client-built seed
  // (buildSeedFromSpreadsheet) can never produce null here: every
  // client-side exception is built directly from a row already in hand.
  sourceRow: number | null;
}

export interface DatasetSummary {
  asOf: string;
  sourceFile: string;
  subscriberCount: number;
  activeSubscriberCount: number;
  archivedSubscriberCount: number;
  recipientCount: number;
  orderCount: number;
  subscriptionCount: number;
  mailingCount: number;
  openMailingCount: number;
  archivedMailingCount: number;
  overdueCount: number;
  dueNext14Count: number;
  exceptionCount: number;
  missingShipDateCount: number;
}

export interface Dataset {
  summary: DatasetSummary;
  subscribers: DatasetSubscriber[];
  recipients: DatasetRecipient[];
  orders: DatasetOrder[];
  subscriptions: DatasetSubscription[];
  mailings: DatasetMailing[];
  exceptions: DatasetException[];
  automationRules: unknown[];
}

// What an import skipped, and why - produced by lib/write-to-tables.ts's
// writeImport() (server-side), carried in POST /api/shared-state's
// response body, and read by lib/client/shared-state-client.ts's
// saveSharedDataset() to show the Import Sheet view's reconciliation
// panel. Defined here, not in lib/write-to-tables.ts itself, specifically
// so lib/client/ can import the type without importing server-side `lib/`
// (which pulls in the Drizzle schema/db connection - see this codebase's
// own import-direction rule, docs/architecture.md). One group per skip
// *reason*, not one per skipped row - see ImportSummary's own comment for
// why the same source row can legitimately appear under more than one
// reason.
export interface DatasetImportSkipGroup {
  reason: string;
  count: number;
  sourceRows: number[];
}

// totalRows is "rows in the file" (buildSeedFromSpreadsheet produces
// exactly one candidate mailing per surviving row, so seed.mailings.length
// doubles as this); mailingsWritten is how many actually landed in the
// mailings table. `skipped` groups are NOT mutually exclusive by row: a
// row whose subscription has an unrecognized plan is reported once under
// that reason and again under "mailing's subscription was not kept" -
// both are real, separate writes that got skipped for that one row, not
// duplication to clean up.
export interface DatasetImportSummary {
  totalRows: number;
  mailingsWritten: number;
  skipped: DatasetImportSkipGroup[];
}
