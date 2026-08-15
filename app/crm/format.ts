/**
 * Display formatting used only by views - escaping, CSS-class-safe status
 * strings, number formatting, and search matching. Pure, but the server
 * has no use for any of these, so they stay out of lib/domain/
 * deliberately: escapeHtml in particular is transitional and disappears
 * entirely once views become React and escaping is automatic, which would
 * be a strange thing to ship server-side as "domain" logic.
 *
 * formatDate/titleCase are NOT here - they moved to lib/domain/format.ts
 * once storageBinForMailing/envelopeStockForCharacter (which depend on
 * them) turned out to be real domain logic, not display chrome - see that
 * module's header. includesText stays here rather than following: it's
 * search matching, arguably a domain rule too, but nothing in lib/domain/
 * actually needs it (nothing server-side searches).
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
