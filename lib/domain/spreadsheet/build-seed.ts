import { normalizeSpreadsheetRow, getSpreadsheetValue, splitNameAddress, compactOrderNumber, spreadsheetDateToIso, compactNumber, normalizeStatus, normalizeBoolean } from "./normalize";
import { normalizePlan } from "../plans";
import { normalizeCharacter } from "../characters";
import { buildSubscriberId, buildRecipientId, buildSubscriptionId, buildMailingId } from "../ids";
import { todayIso, monthKey, nearestBatchDate, isOverdueMailing, isDueNext14Days, isOpenStatus } from "../mailing-rules";
import { spreadsheetExceptionReasons, duplicateMailingFlags, DUPLICATE_MAILING_SEVERITY, explicitExceptionSeverity } from "./exceptions";
import type { Dataset, DatasetSubscriber, DatasetRecipient, DatasetOrder, DatasetSubscription, DatasetMailing, DatasetException, DatasetSummary } from "../dataset";

/**
 * Parses an uploaded mailing-schedule spreadsheet into the full CRM
 * dataset shape (subscribers/recipients/orders/subscriptions/mailings/
 * exceptions/summary/automationRules) - the client-side half of the
 * import flow (app/crm/views/import/import-selectors.ts's readWorkbookFile
 * calls this after SheetJS/XLSX parses the raw file - moved there from
 * app/crm/legacy-app.js in Phase 1 step 11, CLAUDE.md). Returns the canonical `Dataset`
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
        severity: reasons.some((reason) => explicitExceptionSeverity(reason) === 'High' || reason.includes('Missing') || reason.includes('ship date')) ? 'High' : 'Low',
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

  // Cross-row pass: spreadsheetExceptionReasons above only ever sees one
  // row at a time, so it can't catch two rows colliding on the same
  // order+character+letter number - the same ambiguity lib/write-to-tables.ts's
  // own writeImport() drops rather than guessing through (see
  // lib/domain/mailing-collision.ts). Runs after the per-row loop, over
  // the SAME `mailings` array that loop just built, and merges into the
  // SAME `exceptions` array - keyed by sourceRow, NOT mailingId: all rows
  // colliding on order+character+letterNumber also collide on app.js's own
  // generated mailingId (buildMailingId hashes letterNumber when present,
  // never sourceRow - confirmed directly against the real fixture), so
  // mailingId can't disambiguate rows here the way it usually can.
  //
  // Escalates an existing per-row exception in place (appends to its
  // reason, raises its severity to High if the duplicate severity says so)
  // rather than pushing a second exceptions row for the same mailingId -
  // the normalized `exceptions` table only ever holds one row per
  // mailing_id (lib/write-to-tables.ts) - and only increments issueCount
  // for a row that didn't already have one.
  //
  // Deliberately NOT gated by activeState === 'Active' the way every
  // reason above is: lib/write-to-tables.ts's own collision check isn't
  // gated by activeState either (an archived mailing can still collide
  // with an active one and get dropped), so gating this pass would
  // silently under-report exactly the "stays silent on rows that vanish"
  // failure this feature exists to close.
  const exceptionsBySourceRow = new Map(exceptions.map((exception) => [exception.sourceRow, exception]));
  const addHighRisk = (mailing: DatasetMailing, reason: string) => {
    const existing = exceptionsBySourceRow.get(mailing.sourceRow);
    if (existing) {
      if (!existing.reason.includes(reason)) existing.reason = `${existing.reason}; ${reason}`;
      existing.severity = 'High';
      return;
    }
    const subscriber = subscribers.get(mailing.subscriberId);
    if (subscriber) subscriber.issueCount += 1;
    const item: DatasetException = {
      exceptionId: `EX-${mailing.sourceRow}`,
      severity: 'High',
      reason,
      mailingId: mailing.mailingId,
      subscriberId: mailing.subscriberId,
      recipientName: mailing.recipientName,
      shipDate: mailing.shipDate,
      suggestedShipDate: '',
      status: mailing.status,
      sourceRow: mailing.sourceRow,
    };
    exceptions.push(item);
    exceptionsBySourceRow.set(mailing.sourceRow, item);
  };
  for (const { mailing, reason } of duplicateMailingFlags(mailings)) {
    const existing = exceptionsBySourceRow.get(mailing.sourceRow);
    if (existing) {
      existing.reason = `${existing.reason}; ${reason}`;
      if (DUPLICATE_MAILING_SEVERITY === 'High') existing.severity = 'High';
    } else {
      const subscriber = subscribers.get(mailing.subscriberId);
      if (subscriber) subscriber.issueCount += 1;
      const newException: DatasetException = {
        exceptionId: `EX-${mailing.sourceRow}`,
        severity: DUPLICATE_MAILING_SEVERITY,
        reason,
        mailingId: mailing.mailingId,
        subscriberId: mailing.subscriberId,
        recipientName: mailing.recipientName,
        shipDate: mailing.shipDate,
        suggestedShipDate: '',
        status: mailing.status,
        sourceRow: mailing.sourceRow,
      };
      exceptions.push(newException);
      exceptionsBySourceRow.set(mailing.sourceRow, newException);
    }
  }

  // A matching recipient name and address under different customer IDs is
  // usually a duplicate record caused by a changed/mistyped email. Flag all
  // involved active rows so a human chooses the correct customer record.
  const identityGroups = new Map<string, typeof normalizedRows>();
  for (const row of normalizedRows) {
    if (!row.recipientName || row.recipientName === 'Unknown recipient' || !row.address) continue;
    const identity = `${row.recipientName.toLowerCase()}::${row.address.toLowerCase()}`;
    const group = identityGroups.get(identity) ?? [];
    group.push(row);
    identityGroups.set(identity, group);
  }
  for (const group of identityGroups.values()) {
    const customerIds = new Set(group.map((row) => buildSubscriberId({ email: row.email, recipientName: row.recipientName, address: row.address })));
    if (customerIds.size < 2) continue;
    const rows = new Set(group.map((row) => row.sourceRow));
    mailings.filter((mailing) => rows.has(mailing.sourceRow) && mailing.activeState === 'Active')
      .forEach((mailing) => addHighRisk(mailing, 'Possible duplicate customer: same recipient name and address appears under multiple customer records'));
  }

  // Two active plans for the same customer, recipient, and character can
  // generate two letters for the same subscription period.
  const overlapGroups = new Map<string, DatasetSubscription[]>();
  for (const subscription of subscriptions.values()) {
    if (subscription.activeState !== 'Active') continue;
    const key = `${subscription.subscriberId}::${subscription.recipientId}::${subscription.character.toLowerCase()}`;
    const group = overlapGroups.get(key) ?? [];
    group.push(subscription);
    overlapGroups.set(key, group);
  }
  for (const group of overlapGroups.values()) {
    if (group.length < 2) continue;
    const overlapping = group.filter((subscription, index) => group.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      const start = subscription.startDate || '0000-01-01';
      const end = subscription.endDate || '9999-12-31';
      const otherStart = other.startDate || '0000-01-01';
      const otherEnd = other.endDate || '9999-12-31';
      return start <= otherEnd && otherStart <= end;
    }));
    const ids = new Set(overlapping.map((subscription) => subscription.subscriptionId));
    mailings.filter((mailing) => ids.has(mailing.subscriptionId) && mailing.activeState === 'Active')
      .forEach((mailing) => addHighRisk(mailing, 'Overlapping subscriptions: multiple active plans exist for this recipient and character'));
  }

  // Letter numbers should be unique and move forward with ship dates inside
  // one subscription. A gap, duplicate, or backwards step is held for review
  // because it can send a recipient the wrong part of their story.
  const sequenceGroups = new Map<string, DatasetMailing[]>();
  for (const mailing of mailings) {
    if (mailing.activeState !== 'Active') continue;
    const group = sequenceGroups.get(mailing.subscriptionId) ?? [];
    group.push(mailing);
    sequenceGroups.set(mailing.subscriptionId, group);
  }
  for (const group of sequenceGroups.values()) {
    const numbered = group.filter((mailing) => /^\d+$/.test(String(mailing.letterNumber)));
    const byNumber = new Map<number, DatasetMailing[]>();
    for (const mailing of numbered) {
      const number = Number(mailing.letterNumber);
      const matches = byNumber.get(number) ?? [];
      matches.push(mailing);
      byNumber.set(number, matches);
    }
    for (const [number, matches] of byNumber) {
      if (matches.length > 1) matches.forEach((mailing) => addHighRisk(mailing, `Duplicate letter number: letter ${number} appears more than once in this subscription`));
    }

    const chronological = numbered
      .filter((mailing) => mailing.shipDate)
      .sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.sourceRow - b.sourceRow);
    for (let index = 1; index < chronological.length; index += 1) {
      const previous = chronological[index - 1];
      const current = chronological[index];
      const previousNumber = Number(previous.letterNumber);
      const currentNumber = Number(current.letterNumber);
      if (currentNumber === previousNumber) continue;
      if (currentNumber !== previousNumber + 1) {
        addHighRisk(current, `Letter sequence out of sync: letter ${currentNumber} follows letter ${previousNumber} by ship date`);
      }
    }
  }

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
