/**
 * Flags a normalized spreadsheet row as broken/needs-review data: missing
 * required fields, a ship date that isn't a real 1st/15th batch date, or a
 * mailing already marked Mailed with a ship date still in the future.
 * These are exactly the exception reasons buildSeedFromSpreadsheet
 * (lib/domain/spreadsheet/build-seed.ts) turns into `exceptions` array
 * entries for Active rows. Pure - the reference "today" is a real
 * parameter, not read from `new Date()` - so it ships in both the client
 * bundle (app/crm/legacy-app.js) and server code.
 */

export interface ExceptionCheckRow {
  recipientName: string;
  address: string;
  email: string;
  character: string;
  plan: string;
  shipDate: string;
  status: string;
}

// `today` (a "YYYY-MM-DD" string, e.g. from lib/domain/mailing-rules.ts's
// todayIso()) is threaded in explicitly by the caller rather than read from
// the clock here - same reasoning as todayIso(now) itself (step 3a) and
// buildSeedFromSpreadsheet(rows, sourceName, now, ...) (this same step):
// a function that reads "now" internally can't be tested without patching
// the global Date.
export function spreadsheetExceptionReasons(row: ExceptionCheckRow, activeState: string, today: string): string[] {
  const reasons: string[] = [];
  if (!row.recipientName || row.recipientName === "Unknown recipient") reasons.push("Missing recipient");
  if (!row.address) reasons.push("Missing address");
  if (!row.email) reasons.push("Missing email");
  if (!row.character || row.character === "Needs Review") reasons.push("Missing character");
  if (!row.plan || row.plan === "Needs Review") reasons.push("Missing subscription");
  if (!row.shipDate) reasons.push("Missing ship date");
  if (row.shipDate) {
    const day = Number(row.shipDate.slice(-2));
    if (![1, 15].includes(day)) reasons.push("Ship date is not a 1st/15th batch");
  }
  if (activeState === "Active" && row.status === "Mailed" && row.shipDate && row.shipDate > today) {
    reasons.push("Future mailing already marked mailed");
  }
  return reasons;
}
