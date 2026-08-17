/**
 * Display formatting used only by views - escaping, CSS-class-safe status
 * strings, and number formatting. Pure, but the server has no use for any
 * of these, so they stay out of lib/domain/ deliberately: escapeHtml in
 * particular is transitional and disappears entirely once views become
 * React and escaping is automatic, which would be a strange thing to ship
 * server-side as "domain" logic.
 *
 * formatDate/titleCase are NOT here - they moved to lib/domain/format.ts
 * once storageBinForMailing/envelopeStockForCharacter (which depend on
 * them) turned out to be real domain logic, not display chrome - see that
 * module's header. includesText isn't here either, as of Phase 1 step 7
 * (CLAUDE.md): it moved one layer over, to lib/client/selectors.ts, once
 * a cross-view selector (packetRows) needed it too - see that file's own
 * header for the full reasoning. Unlike escapeHtml/statusClass/number
 * below, it was never really view-only, just previously only used by
 * views.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function statusClass(status: unknown): string {
  return String(status).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function number(value: unknown): string {
  return Number(value || 0).toLocaleString();
}
