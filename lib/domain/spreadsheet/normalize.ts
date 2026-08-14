/**
 * Normalizes a raw parsed spreadsheet row (arbitrary header casing/
 * punctuation, cell values of whatever type SheetJS/XLSX produced) into the
 * plain strings buildSeedFromSpreadsheet works with. Pure - no DOM, no
 * state, no clock - so it ships in both the client bundle
 * (app/crm/legacy-app.js, where the browser-side xlsx parser produces these
 * raw rows) and server code.
 */

// Lowercases and strips everything but letters/digits, so header lookups
// don't care about spacing, punctuation, or casing differences between
// spreadsheet versions ("Order ID", "order-id", "Order  Id" all normalize
// to "orderid").
export function normalizeHeader(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Rekeys a raw row object (as SheetJS/XLSX produces it) by normalizeHeader,
// so downstream lookups can use any header spelling variant without caring
// which one the actual uploaded file used.
export function normalizeSpreadsheetRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[normalizeHeader(key)] = value;
  });
  return normalized;
}

// Reads the first non-blank value found under any of the given header name
// variants (e.g. "Order ID" vs "Order Number") - real spreadsheets from
// different exports don't agree on exact column names.
export function getSpreadsheetValue(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

// Converts a spreadsheet date cell - which could be a real Date (SheetJS
// with cellDates), an Excel serial number, or a free-text string in ISO or
// US format - into a plain "YYYY-MM-DD" string. Falls through several
// parsing strategies in order, most-specific-first, before giving up and
// deferring to the runtime's own Date parser as a last resort.
export function spreadsheetDateToIso(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Excel's date epoch is 1899-12-30; 25569 is the number of days from
    // there to the Unix epoch (1970-01-01), so subtracting it converts an
    // Excel serial day number into Unix days before scaling to ms.
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }
  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  return "";
}

export interface SplitNameAddress {
  name: string;
  address: string;
}

// Splits the single "Customer Name and Address" spreadsheet cell (name on
// the first line, address on the rest) into separate fields - the cell has
// no structured delimiter beyond line breaks, so this is the only split
// the source data supports.
export function splitNameAddress(block: unknown): SplitNameAddress {
  const lines = String(block || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    name: lines[0] || "Unknown recipient",
    address: lines.slice(1).join(", ").replace(/\s+/g, " ").trim(),
  };
}

// Recognizes loose spreadsheet phrasing for a boolean cell ("Yes"/"Y"/"1"/
// "Active"/"Checked", case-insensitive) rather than requiring a real
// boolean value - most spreadsheet exports represent booleans as text.
export function normalizeBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return false;
  return ["true", "yes", "y", "1", "active", "checked"].includes(raw);
}

// Recognizes loose spreadsheet phrasing for a mailing status rather than
// requiring an exact match against the canonical status list.
export function normalizeStatus(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "To Prepare";
  const lower = raw.toLowerCase();
  if (lower.includes("print")) return "Printing";
  if (lower.includes("assem")) return "Assembling";
  if (lower.includes("ready")) return "Ready to Mail";
  if (lower.includes("mail")) return "Mailed";
  if (lower.includes("prepare") || lower.includes("prep")) return "To Prepare";
  return raw;
}

// Strips a spurious ".0" suffix Excel sometimes appends to an
// integer-looking order/letter number when the source column was
// numerically typed (e.g. "1042.0" -> "1042"). Identical body to
// compactNumber() below - both kept as-is, not deduplicated, since this
// step is a pure relocation (see the task this was extracted under).
export function compactOrderNumber(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d+\.0$/.test(raw)) return raw.replace(/\.0$/, "");
  return raw;
}

// See compactOrderNumber() above - identical body, kept separate as-is.
export function compactNumber(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d+\.0$/.test(raw)) return raw.replace(/\.0$/, "");
  return raw;
}
