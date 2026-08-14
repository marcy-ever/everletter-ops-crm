/**
 * The mailing business rules: which statuses count as "open," whether a
 * mailing is overdue or due in the next 14 days, and the nearest 1st/15th
 * batch date for a given ship date. The single implementation, imported
 * both client-side (app/crm/legacy-app.js's buildSeedFromSpreadsheet and
 * its own render logic) and server-side (lib/build-dataset-from-tables.ts).
 * tests/mailing-rules.test.mjs locks the exact output for a fixed set of
 * sample inputs.
 *
 * `isOverdueMailing`/`isDueNext14Days`/`todayIso` all take the reference
 * date as an explicit parameter rather than reading the clock themselves -
 * this is what makes a real, deliberate behavior difference between the two
 * call sites possible without needing two implementations: app.js's
 * buildSeedFromSpreadsheet computes `overdue`/`dueNext14Days`/`summary.asOf`
 * once, frozen at spreadsheet-import time (passing `new Date()` at the
 * moment of import), while the server-side reconstruction
 * (lib/build-dataset-from-tables.ts) recomputes these LIVE at query time
 * instead (an overdue mailing should show as overdue immediately, not just
 * after the next reimport) by passing a freshly-read `new Date()` on every
 * call. Same functions, different instant passed in - not a bug.
 */

export const OPEN_STATUSES = new Set(["To Prepare", "Printing", "Assembling", "Ready to Mail"]);

export function isOpenStatus(status: string | null | undefined): boolean {
  return OPEN_STATUSES.has(status ?? "");
}

// The LOCAL calendar date of `now`, as "YYYY-MM-DD". The
// getTimezoneOffset() round-trip is deliberate (see the git history behind
// PR #3, "Fix spreadsheet import date shifting back a day in western
// timezones") - it makes the result stable regardless of which timezone
// the runtime (browser or server) happens to be in.
export function todayIso(now: Date): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// Whole days from startIso to endIso, parsing both as local midnight so
// the result isn't sensitive to either string's implicit time component.
export function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export interface OverdueInput {
  activeState: string;
  status: string;
  shipDate: string | null | undefined;
}

// Active, an open status, a real ship date, and that ship date is in the
// past relative to `today`.
export function isOverdueMailing({ activeState, status, shipDate }: OverdueInput, today: string): boolean {
  return activeState === "Active" && isOpenStatus(status) && !!shipDate && shipDate < today;
}

// Active, an open status, a real ship date, and that ship date falls
// within [today, today + 14 days].
export function isDueNext14Days({ activeState, status, shipDate }: OverdueInput, today: string): boolean {
  if (activeState !== "Active" || !isOpenStatus(status) || !shipDate) return false;
  const delta = daysBetween(today, shipDate);
  return delta >= 0 && delta <= 14;
}

export function monthKey(dateValue: string | null | undefined): string {
  return dateValue ? String(dateValue).slice(0, 7) : "";
}

// Snaps a ship date to the nearest 1st/15th batch date. Timezone-stable
// for the same reason todayIso() is -
// it parses and re-serializes using the runtime's own local timezone
// consistently on both ends, so it produces the same string regardless of
// which timezone the runtime is in.
export function nearestBatchDate(dateValue: string | null | undefined): string {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getDate();
  if (day === 1 || day === 15) return dateValue;
  if (day < 8) date.setDate(1);
  else if (day < 23) date.setDate(15);
  else {
    date.setMonth(date.getMonth() + 1);
    date.setDate(1);
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
