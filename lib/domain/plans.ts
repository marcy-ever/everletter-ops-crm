/**
 * Subscription plan rules: normalizing a raw spreadsheet plan value into
 * one of the canonical plan names, and everything derived from a plan once
 * it's normalized (how many letters it's expected to produce, which print
 * workflow it uses, how many envelopes a single mailing needs). Pure -
 * no DOM, no state, no clock - so it ships in both the client bundle
 * (app/crm/legacy-app.js) and server code.
 */

export type Plan = "Month-to-month" | "6-month" | "12-month" | "One-time" | "Needs Review" | string;

// Recognizes loose spreadsheet phrasing ("6 Month", "Renewal", "Sample",
// digit-only "1"/"6"/"12") rather than requiring an exact match - real
// spreadsheet data isn't consistent about this. Order matters: checked
// most-specific-first (12 before 6, since "612-month" would otherwise be
// ambiguous - not a real case, but the check order is deliberate either way).
export function normalizePlan(value: unknown): Plan {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return "Needs Review";
  if (lower.includes("12")) return "12-month";
  if (lower.includes("6")) return "6-month";
  if (lower.includes("month") || lower.includes("renewal")) return "Month-to-month";
  if (lower.includes("one") || lower.includes("sample") || lower.includes("1")) return "One-time";
  return raw;
}

// How many letters a subscription of this plan is expected to produce over
// its lifetime - drives subscriptions.total_letters_expected server-side
// (see lib/write-to-tables.ts) and letter-count expectations client-side.
export function plannedLetterCount(plan: string): number {
  if (plan === "Month-to-month") return 2;
  if (plan === "6-month") return 12;
  if (plan === "12-month") return 24;
  return 1;
}

// Which print workflow a plan uses: Month-to-month prints on demand per
// batch; 6/12-month ("Prepaid bulk") are usually prepared in advance;
// anything else ("Special") covers One-time/Needs Review and whatever else
// falls outside the two metered patterns.
export function printModeForPlan(plan: string): "Month-to-month" | "Prepaid bulk" | "Special" {
  if (plan === "Month-to-month") return "Month-to-month";
  if (plan === "6-month" || plan === "12-month") return "Prepaid bulk";
  return "Special";
}

// Month-to-month customers receive two letters per payment and need two
// envelopes printed together; every other plan needs one.
export function envelopeQuantityForMailing(mailing: { plan: string }): number {
  return mailing.plan === "Month-to-month" ? 2 : 1;
}

// Parses a letter-number spreadsheet value into a real number, defaulting
// to 0 for blank/non-numeric input rather than propagating NaN.
export function numericLetter(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}
