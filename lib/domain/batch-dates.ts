/**
 * Generates the sequence of future 1st/15th batch dates a prepaid
 * (6/12-month) order's letters will ship on, and which physical storage
 * bin (Ashley's) a mailing belongs in. Pure - no DOM, no state, no clock
 * (orderDate is a real parameter, not read from `new Date()`) - so it
 * ships in both the client bundle (app/crm/legacy-app.js) and server code.
 *
 * monthKey()/nearestBatchDate() cover related batch-date logic but already
 * live in lib/domain/mailing-rules.ts - left there rather than moved here,
 * to avoid reshuffling something that already has a stable home.
 */

import { formatDate } from "./format";

// Everletter's cadence is the 1st and 15th of each month, with a roughly
// 3-day cutoff: an order placed too close to the next batch date rolls to
// the one after. Starting from orderDate, walks forward one candidate batch
// date at a time (skipping any less than 3 days out) until `count` dates
// are collected - this is how a 6/12-month order's full mailing schedule
// gets generated up front.
export function batchDatesForOrder(orderDate: string, count: number): string[] {
  const dates: string[] = [];
  const start = new Date(`${orderDate}T00:00:00`);
  const cursor = new Date(start);
  cursor.setDate(1);

  while (dates.length < count) {
    for (const day of [1, 15]) {
      const batch = new Date(cursor);
      batch.setDate(day);
      // batch.getTime() - start.getTime(), not `batch - start`: identical
      // result (Date's implicit numeric coercion is its getTime()), but
      // TypeScript's strict mode rejects arithmetic directly on two Date
      // operands - forced by typing this module for real, not a rewrite.
      const diffDays = Math.ceil((batch.getTime() - start.getTime()) / 86400000);
      if (diffDays >= 3) {
        dates.push(new Date(batch.getTime() - batch.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
        if (dates.length === count) break;
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return dates;
}

// Every upcoming operational batch through the same calendar day 18 months
// from `today`. The current month and the ending month are both considered,
// with past 1st/15th dates filtered out.
export function upcomingBatchDates(today: string, monthsAhead = 18): string[] {
  const [startYear, startMonth, startDay] = today.split("-").map(Number);
  const endMonthIndex = startYear * 12 + (startMonth - 1) + monthsAhead;
  const endDate = `${Math.floor(endMonthIndex / 12)}-${String((endMonthIndex % 12) + 1).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
  const dates: string[] = [];

  for (let monthIndex = startYear * 12 + (startMonth - 1); monthIndex <= endMonthIndex; monthIndex += 1) {
    const year = Math.floor(monthIndex / 12);
    const month = String((monthIndex % 12) + 1).padStart(2, "0");
    for (const day of ["01", "15"]) {
      const date = `${year}-${month}-${day}`;
      if (date >= today && date <= endDate) dates.push(date);
    }
  }

  return dates;
}

// The physical Ashley storage bin a mailing belongs in, grouped by ship
// date - "Needs date" for a mailing with no ship date to group by yet.
export function storageBinForMailing(mailing: { shipDate: string }): string {
  if (!mailing.shipDate) return "Needs date";
  return `Ashley / ${formatDate(mailing.shipDate)} bin`;
}
