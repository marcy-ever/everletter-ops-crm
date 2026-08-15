/**
 * Formatting primitives needed by domain logic that produces real
 * operational identities - a physical storage bin label
 * (lib/domain/batch-dates.ts's storageBinForMailing), a print-run
 * envelope-stock grouping (lib/domain/characters.ts's
 * envelopeStockForCharacter) - not just view display. Pure - no DOM, no
 * state, no clock (formatDate parses the date string it's given; it never
 * reads "now") - so these ship in both the client bundle
 * (app/crm/legacy-app.js) and server code.
 *
 * escapeHtml/statusClass/number/includesText stay in app/crm/format.ts -
 * those are genuinely view-only (escapeHtml disappears entirely once
 * views are React and escaping is automatic).
 */

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Needs date";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function titleCase(value: unknown): string {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
