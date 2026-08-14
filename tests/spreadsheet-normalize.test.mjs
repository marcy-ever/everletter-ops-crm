import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeHeader,
  normalizeSpreadsheetRow,
  getSpreadsheetValue,
  spreadsheetDateToIso,
  splitNameAddress,
  normalizeBoolean,
  normalizeStatus,
  compactOrderNumber,
  compactNumber,
} from "../lib/domain/spreadsheet/normalize.ts";

// New coverage from step 3b's extraction (lib/domain/spreadsheet/normalize.ts
// didn't exist before this) - not a re-assertion of what the render
// snapshots already cover. All expected values below were captured by
// actually running the (unchanged) implementation, not hand-computed.

test("normalizeHeader lowercases and strips punctuation/spacing so header spelling variants match", () => {
  assert.equal(normalizeHeader("Order ID"), "orderid");
  assert.equal(normalizeHeader("  Ship Date! "), "shipdate");
});

test("normalizeSpreadsheetRow rekeys a raw row by normalizeHeader", () => {
  assert.deepEqual(normalizeSpreadsheetRow({ "Order ID": "5001", "Ship Date": "2026-08-15" }), { orderid: "5001", shipdate: "2026-08-15" });
});

test("getSpreadsheetValue reads the first non-blank value across header name variants, falling back to ''", () => {
  const row = normalizeSpreadsheetRow({ "Order ID": "5001", "Ship Date": "" });
  assert.equal(getSpreadsheetValue(row, "Order ID", "Order Number"), "5001");
  assert.equal(getSpreadsheetValue(row, "Ship Date", "Mailing Date"), "", "blank cell counts as not-found, falls through to the fallback name and then to ''");
  assert.equal(getSpreadsheetValue(row, "Nonexistent"), "");
});

test("spreadsheetDateToIso handles a real Date object", () => {
  assert.equal(spreadsheetDateToIso(new Date("2026-08-15T00:00:00Z")), "2026-08-15");
});

test("spreadsheetDateToIso handles an Excel serial day number", () => {
  assert.equal(spreadsheetDateToIso(46615), "2027-08-16");
});

test("spreadsheetDateToIso handles ISO-formatted text, dash or slash separated", () => {
  assert.equal(spreadsheetDateToIso("2026-08-15"), "2026-08-15");
  assert.equal(spreadsheetDateToIso("2026/08/15"), "2026-08-15");
});

test("spreadsheetDateToIso handles US-formatted text, 4-digit or 2-digit year", () => {
  assert.equal(spreadsheetDateToIso("8/15/2026"), "2026-08-15");
  assert.equal(spreadsheetDateToIso("8/15/26"), "2026-08-15");
});

test("spreadsheetDateToIso falls back to the runtime's own Date parser for other text formats", () => {
  assert.equal(spreadsheetDateToIso("Aug 15 2026"), "2026-08-15");
});

test("spreadsheetDateToIso returns '' for blank or unparseable input", () => {
  assert.equal(spreadsheetDateToIso(""), "");
  assert.equal(spreadsheetDateToIso(null), "");
  assert.equal(spreadsheetDateToIso("not a date"), "");
});

test("splitNameAddress puts the first line in name, joins the remaining lines with ', ' as address", () => {
  assert.deepEqual(splitNameAddress("Jane Doe\n123 Main St\nSpringfield, ST 00000"), {
    name: "Jane Doe",
    address: "123 Main St, Springfield, ST 00000",
  });
});

test("splitNameAddress handles a name with no address lines", () => {
  assert.deepEqual(splitNameAddress("Solo Name"), { name: "Solo Name", address: "" });
});

test("splitNameAddress falls back to 'Unknown recipient' for blank input", () => {
  assert.deepEqual(splitNameAddress(""), { name: "Unknown recipient", address: "" });
});

test("normalizeBoolean recognizes real booleans and loose truthy text, case-insensitively", () => {
  assert.equal(normalizeBoolean(true), true);
  assert.equal(normalizeBoolean(false), false);
  assert.equal(normalizeBoolean("yes"), true);
  assert.equal(normalizeBoolean("Y"), true);
  assert.equal(normalizeBoolean("1"), true);
  assert.equal(normalizeBoolean("active"), true);
  assert.equal(normalizeBoolean("checked"), true);
});

test("normalizeBoolean defaults to false for anything else, including blank/missing", () => {
  assert.equal(normalizeBoolean("no"), false);
  assert.equal(normalizeBoolean(""), false);
  assert.equal(normalizeBoolean(null), false);
  assert.equal(normalizeBoolean(undefined), false);
});

test("normalizeStatus recognizes loose spreadsheet phrasing for each canonical status", () => {
  assert.equal(normalizeStatus("Printing"), "Printing");
  assert.equal(normalizeStatus("assembled"), "Assembling");
  assert.equal(normalizeStatus("ready to go"), "Ready to Mail");
  assert.equal(normalizeStatus("mailed out"), "Mailed");
  assert.equal(normalizeStatus("To Prep"), "To Prepare");
});

test("normalizeStatus defaults blank input to 'To Prepare', and returns unrecognized text as-is", () => {
  assert.equal(normalizeStatus(""), "To Prepare");
  assert.equal(normalizeStatus("Weird Status"), "Weird Status");
});

test("compactOrderNumber/compactNumber strip a spurious Excel '.0' suffix from an integer-looking value", () => {
  assert.equal(compactOrderNumber("1042.0"), "1042");
  assert.equal(compactNumber("1042.0"), "1042");
});

test("compactOrderNumber/compactNumber pass a plain integer-looking value through unchanged, and blank input through as ''", () => {
  assert.equal(compactOrderNumber("1042"), "1042");
  assert.equal(compactNumber("1042"), "1042");
  assert.equal(compactOrderNumber(""), "");
  assert.equal(compactOrderNumber(null), "");
});
