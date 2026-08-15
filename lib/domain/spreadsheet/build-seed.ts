import { normalizeSpreadsheetRow, getSpreadsheetValue, splitNameAddress, compactOrderNumber, spreadsheetDateToIso, compactNumber, normalizeStatus, normalizeBoolean } from "./normalize";
import { normalizePlan } from "../plans";
import { normalizeCharacter } from "../characters";
import { buildSubscriberId, buildRecipientId, buildSubscriptionId, buildMailingId } from "../ids";
import { todayIso, monthKey, nearestBatchDate, isOverdueMailing, isDueNext14Days, isOpenStatus } from "../mailing-rules";
import { spreadsheetExceptionReasons } from "./exceptions";
import type { Dataset, DatasetSubscriber, DatasetRecipient, DatasetOrder, DatasetSubscription, DatasetMailing, DatasetException, DatasetSummary } from "../dataset";

/**
 * Parses an uploaded mailing-schedule spreadsheet into the full CRM
 * dataset shape (subscribers/recipients/orders/subscriptions/mailings/
 * exceptions/summary/automationRules) - the client-side half of the
 * import flow (app/crm/legacy-app.js's readWorkbookFile calls this after
 * SheetJS/XLSX parses the raw file). Returns the canonical `Dataset`
 * shape (lib/domain/dataset.ts) - the same shape the server-side
 * reconstruction (lib/build-dataset-from-tables.ts) produces from the
 * normalized tables, which is exactly why the type lives in one place
 * both sides import instead of two independently-maintained copies.
 *
 * Pure - `now` (the reference instant "today" is computed from) and
 * `automationRules` are both real parameters, not read from `new Date()`
 * or `window.EVERLETTER_SEED`/`state.seed` - so it ships in both the
 * client bundle and server code (not currently imported server-side, but
 * nothing stops it).
 */

export interface NormalizedSpreadsheetRow {
  sourceRow: number;
  orderNumber: string;
  orderDate: string;
  endDate: string;
  recipientName: string;
  address: string;
  character: string;
  letterNumber: string;
  shipDate: string;
  suggestedShipDate: string;
  plan: string;
  status: string;
  notes: string;
  active: boolean;
  email: string;
}

export function buildSeedFromSpreadsheet(rows: Record<string, unknown>[], sourceName: string, now: Date, automationRules: unknown[]): Dataset {
  const normalizedRows: NormalizedSpreadsheetRow[] = rows
    .map((raw, index) => ({ raw: normalizeSpreadsheetRow(raw), sourceRow: index + 2 }))
    .map(({ raw, sourceRow }) => {
      const customerBlock = getSpreadsheetValue(raw, 'Customer Name and Address', 'Customer Name/Address', 'Name and Address');
      const recipient = splitNameAddress(customerBlock);
      const orderNumber = compactOrderNumber(getSpreadsheetValue(raw, 'Order ID', 'Order Number'));
      const orderDate = spreadsheetDateToIso(getSpreadsheetValue(raw, 'Original Order Date', 'Original Order date', 'Order Date'));
      const shipDate = spreadsheetDateToIso(getSpreadsheetValue(raw, 'Ship Date', 'Mailing Date'));
      const endDate = spreadsheetDateToIso(getSpreadsheetValue(raw, 'End Date', 'End date'));
      return {
        sourceRow,
        orderNumber,
        orderDate,
        endDate,
        recipientName: recipient.name,
        address: recipient.address,
        character: normalizeCharacter(getSpreadsheetValue(raw, 'Character')),
        letterNumber: compactNumber(getSpreadsheetValue(raw, 'Letter Number', 'Letter #')),
        shipDate,
        suggestedShipDate: nearestBatchDate(shipDate),
        plan: normalizePlan(getSpreadsheetValue(raw, 'Subscription', 'Plan')),
        status: normalizeStatus(getSpreadsheetValue(raw, 'Status')),
        notes: String(getSpreadsheetValue(raw, 'Notes') || '').trim(),
        active: normalizeBoolean(getSpreadsheetValue(raw, 'Active?', 'Active')),
        email: String(getSpreadsheetValue(raw, 'Email', 'Customer Email') || '').trim().toLowerCase(),
      };
    })
    .filter((row) => row.orderNumber || row.recipientName !== 'Unknown recipient' || row.email || row.shipDate);

  const subscribers = new Map<string, DatasetSubscriber>();
  const recipients = new Map<string, Omit<DatasetRecipient, "characters"> & { characters: Set<string> }>();
  const orders = new Map<string, DatasetOrder>();
  const subscriptions = new Map<string, DatasetSubscription>();
  const mailings: DatasetMailing[] = [];
  const exceptions: DatasetException[] = [];
  const today = todayIso(now);

  normalizedRows.forEach((row) => {
    const subscriberId = buildSubscriberId({ email: row.email, recipientName: row.recipientName, address: row.address });
    const recipientId = buildRecipientId({ subscriberId, recipientName: row.recipientName, address: row.address });
    const orderId = row.orderNumber ? `ORD-${row.orderNumber}` : `ORD-MISSING-${row.sourceRow}`;
    const subscriptionId = buildSubscriptionId({ recipientId, character: row.character, plan: row.plan });
    const activeState = row.active ? 'Active' : 'Archived';
    const mailingId = buildMailingId({ orderId, recipientId, character: row.character, letterNumber: row.letterNumber, sourceRow: row.sourceRow });

    if (!subscribers.has(subscriberId)) {
      subscribers.set(subscriberId, {
        subscriberId,
        email: row.email,
        displayName: row.recipientName,
        status: activeState,
        firstOrderDate: row.orderDate,
        openMailings: 0,
        totalMailings: 0,
        nextShipDate: '',
        issueCount: 0,
      });
    }

    if (!recipients.has(recipientId)) {
      recipients.set(recipientId, {
        recipientId,
        subscriberId,
        name: row.recipientName,
        address: row.address,
        characters: new Set(),
        totalMailings: 0,
        nextShipDate: '',
      });
    }

    if (!orders.has(orderId)) {
      orders.set(orderId, {
        orderId,
        subscriberId,
        sourceOrderNumber: row.orderNumber,
        createdOn: row.orderDate,
        billingMonth: monthKey(row.orderDate),
        plan: row.plan,
        status: 'Imported',
        amount: '',
      });
    }

    if (!subscriptions.has(subscriptionId)) {
      subscriptions.set(subscriptionId, {
        subscriptionId,
        subscriberId,
        recipientId,
        plan: row.plan,
        character: row.character,
        startDate: row.orderDate,
        endDate: row.endDate,
        activeState,
        generatedMailings: 0,
      });
    }

    const mailing: DatasetMailing = {
      mailingId,
      subscriberId,
      recipientId,
      orderId,
      orderDate: row.orderDate,
      subscriptionId,
      recipientName: row.recipientName,
      email: row.email,
      character: row.character,
      plan: row.plan,
      letterNumber: row.letterNumber,
      shipDate: row.shipDate,
      suggestedShipDate: row.suggestedShipDate,
      status: row.status,
      activeState,
      notes: row.notes,
      overdue: isOverdueMailing({ activeState, status: row.status, shipDate: row.shipDate }, today),
      dueNext14Days: isDueNext14Days({ activeState, status: row.status, shipDate: row.shipDate }, today),
      sourceRow: row.sourceRow,
    };
    mailings.push(mailing);

    const subscriber = subscribers.get(subscriberId)!;
    const recipient = recipients.get(recipientId)!;
    const subscription = subscriptions.get(subscriptionId)!;
    subscriber.totalMailings += 1;
    recipient.totalMailings += 1;
    subscription.generatedMailings += 1;
    recipient.characters.add(mailing.character);

    if (activeState === 'Active' && isOpenStatus(mailing.status)) {
      subscriber.openMailings += 1;
      if (mailing.shipDate && (!subscriber.nextShipDate || mailing.shipDate < subscriber.nextShipDate)) subscriber.nextShipDate = mailing.shipDate;
      if (mailing.shipDate && (!recipient.nextShipDate || mailing.shipDate < recipient.nextShipDate)) recipient.nextShipDate = mailing.shipDate;
    }

    const reasons = spreadsheetExceptionReasons(row, activeState, today);
    if (activeState === 'Active' && reasons.length) {
      subscriber.issueCount += 1;
      exceptions.push({
        exceptionId: `EX-${row.sourceRow}`,
        // Case-sensitive on purpose, but a trap for a future edit: this is
        // the *only* thing keeping "Ship date is not a 1st/15th batch" and
        // "Future mailing already marked mailed" at Low severity - both
        // avoid matching only because of the capital S/F. Lowercase either
        // string for readability someday and it silently becomes High,
        // which pulls its mailings out of Production Queue, Batch Print,
        // and Ashley Bins via highExceptionMailingIds. Pinned by
        // tests/spreadsheet-exceptions.test.mjs's severity-classifier tests
        // - a change here should fail those first, not surprise someone in
        // the UI.
        severity: reasons.some((reason) => reason.includes('Missing') || reason.includes('ship date')) ? 'High' : 'Low',
        reason: reasons.join('; '),
        mailingId: mailing.mailingId,
        subscriberId,
        recipientName: mailing.recipientName,
        shipDate: mailing.shipDate,
        suggestedShipDate: reasons.some((reason) => reason.toLowerCase().includes('ship date')) ? mailing.suggestedShipDate : '',
        status: mailing.status,
        sourceRow: row.sourceRow,
      });
    }
  });

  const normalizedRecipients: DatasetRecipient[] = Array.from(recipients.values()).map((recipient) => ({
    ...recipient,
    characters: Array.from(recipient.characters).sort(),
  }));
  const subscriberRows = Array.from(subscribers.values());

  const summary: DatasetSummary = {
    asOf: today,
    sourceFile: sourceName,
    subscriberCount: subscribers.size,
    activeSubscriberCount: subscriberRows.filter((subscriber) => subscriber.status === 'Active').length,
    archivedSubscriberCount: subscriberRows.filter((subscriber) => subscriber.status !== 'Active').length,
    recipientCount: recipients.size,
    orderCount: orders.size,
    subscriptionCount: subscriptions.size,
    mailingCount: mailings.length,
    openMailingCount: mailings.filter((mailing) => mailing.activeState === 'Active' && isOpenStatus(mailing.status)).length,
    archivedMailingCount: mailings.filter((mailing) => mailing.activeState !== 'Active').length,
    overdueCount: mailings.filter((mailing) => mailing.activeState === 'Active' && mailing.overdue).length,
    dueNext14Count: mailings.filter((mailing) => mailing.activeState === 'Active' && mailing.dueNext14Days).length,
    exceptionCount: exceptions.length,
    missingShipDateCount: exceptions.filter((item) => item.reason.includes('ship date')).length,
  };

  return {
    summary,
    subscribers: subscriberRows.sort((a, b) => (a.nextShipDate || '9999').localeCompare(b.nextShipDate || '9999')),
    recipients: normalizedRecipients.sort((a, b) => a.name.localeCompare(b.name)),
    orders: Array.from(orders.values()).sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn))),
    subscriptions: Array.from(subscriptions.values()).sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId)),
    mailings: mailings.sort((a, b) => (a.shipDate || '9999').localeCompare(b.shipDate || '9999')),
    exceptions: exceptions.sort((a, b) => (b.severity.localeCompare(a.severity) || (a.shipDate || '').localeCompare(b.shipDate || ''))),
    automationRules,
  };
}
