/**
 * Generates the sequence of future 1st/15th batch dates a prepaid
 * (6/12-month) order's letters will ship on. Pure - no DOM, no state, no
 * clock (orderDate is a real parameter, not read from `new Date()`) - so it
 * ships in both the client bundle (app/crm/legacy-app.js) and server code.
 *
 * monthKey()/nearestBatchDate() cover related batch-date logic but already
 * live in lib/domain/mailing-rules.ts - left there rather than moved here,
 * to avoid reshuffling something that already has a stable home.
 *
 * storageBinForMailing() is NOT here despite being batch-date-adjacent
 * business logic - it depends on formatDate(), which lives in
 * app/crm/format.ts on purpose (a display-formatting concern, not a domain
 * one), and lib/domain/ can't import from app/. It stays inline in
 * app/crm/legacy-app.js, which can import from both.
 */

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
