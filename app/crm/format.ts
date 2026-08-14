/**
 * Display formatting used only by views - escaping, date/number
 * formatting, CSS-class-safe status strings, title-casing, and search
 * matching. Pure, but the server has no use for "how this looks," so this
 * stays out of lib/domain/ deliberately: escapeHtml in particular is
 * transitional and disappears entirely once views become React and
 * escaping is automatic, which would be a strange thing to ship
 * server-side as "domain" logic.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Needs date";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function includesText(values: unknown[], query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

export function statusClass(status: unknown): string {
  return String(status).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function number(value: unknown): string {
  return Number(value || 0).toLocaleString();
}

export function titleCase(value: unknown): string {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
