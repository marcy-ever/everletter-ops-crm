/**
 * Character-identity rules: normalizing a raw spreadsheet character value
 * into one of the known Everletter characters, and the two lowercase,
 * "new"/"old"-prefix-stripped keys used to look characters up in
 * character-keyed config (Drive folder URLs, letter numbering). Pure - no
 * DOM, no state, no clock - so it ships in both the client bundle
 * (app/crm/legacy-app.js) and server code.
 *
 * envelopeStockForCharacter() is NOT here despite being character-specific
 * business logic - it depends on titleCase(), which lives in
 * app/crm/format.ts on purpose (a display-formatting concern, not a domain
 * one), and lib/domain/ can't import from app/. It stays inline in
 * app/crm/legacy-app.js, which can import from both.
 */

// Recognizes loose spreadsheet phrasing (character names embedded in longer
// strings, e.g. "Marley - Kid") rather than requiring an exact match - real
// spreadsheet data isn't consistent about this. "old marley" is checked
// before the generic character-name scan since it's a distinct character
// identity, not a substring match on "marley".
export function normalizeCharacter(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "Needs Review";
  const lower = raw.toLowerCase();
  const known = ["marley", "ringo", "oliver", "harper", "penelope", "marigold", "seraphine", "legends"];
  if (lower.includes("old marley")) return "Old Marley";
  const found = known.find((name) => lower.includes(name));
  if (found) return found.charAt(0).toUpperCase() + found.slice(1);
  return raw;
}

// The key used to look a character up in character-keyed config (Drive
// folder URLs, envelope stock). Strips a leading "new "/"old " qualifier so
// e.g. "Old Marley" and "Marley" share the same Drive folders, and
// lowercases so lookups aren't case-sensitive.
export function driveCharacterKey(character: unknown): string {
  return String(character || "")
    .trim()
    .replace(/^(new|old)\s+/i, "")
    .toLowerCase();
}

// The key used to look a letter number up in character-keyed, per-letter
// config (e.g. driveConfig.letterFolders). Empty string for anything that
// doesn't parse as a real number, rather than a stringified "NaN".
export function letterNumberKey(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}
