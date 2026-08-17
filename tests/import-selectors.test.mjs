// Coverage for app/crm/views/import/import-selectors.ts - Phase 1 step 11
// (CLAUDE.md). computeImportData() gets full coverage of its own
// (display-only derivation); readWorkbookFile() gets smoke coverage
// against a stubbed window.XLSX - real parsing/normalizing/seed-building
// is buildSeedFromSpreadsheet's own job and already covered by
// tests/build-seed.test.mjs/tests/render-snapshots.test.mjs's fixture -
// this only proves readWorkbookFile's own file-handling logic (sheet
// selection, empty-file/empty-sheet/no-mailings error messages, and that
// it threads `now`/`automationRules` through rather than reading them
// itself).
import assert from "node:assert/strict";
import test from "node:test";
import { computeImportData, defaultAutomationRules, readWorkbookFile } from "../app/crm/views/import/import-selectors.ts";

function seedWith(overrides = {}) {
  return {
    subscribers: [],
    recipients: [],
    subscriptions: [],
    orders: [],
    mailings: [],
    exceptions: [],
    automationRules: [],
    summary: { sourceFile: "starter-data.json", mailingCount: 0, subscriberCount: 0, openMailingCount: 0, exceptionCount: 0 },
    ...overrides,
  };
}

test("computeImportData falls back to the seed's own sourceFile when no import has ever been published", () => {
  const seed = seedWith({ summary: { ...seedWith().summary, sourceFile: "synthetic-rows.json (tests/fixtures)" } });
  const data = computeImportData(seed, new Set(), null, null, "", false);
  assert.equal(data.activeSource, "synthetic-rows.json (tests/fixtures)");
  assert.equal(data.uploadedAt, "Not uploaded yet");
});

test("computeImportData prefers importInfo's sourceName/uploadedAt once a publish has happened", () => {
  const seed = seedWith();
  const importInfo = { seed, sourceName: "updated-schedule.xlsx", uploadedAt: "2026-08-12T18:32:00.000Z", summary: seed.summary };
  const data = computeImportData(seed, new Set(), importInfo, null, "", false);
  assert.equal(data.activeSource, "updated-schedule.xlsx");
  assert.equal(data.uploadedAt, "Aug 12, 2026");
});

test("computeImportData reads mailingCount from the seed and needsReviewCount from activeExceptions, excluding reviewed ones", () => {
  const exception = { exceptionId: "EXC-1", severity: "High", reason: "Missing email", mailingId: "MAIL-1", subscriberId: "SUB-1", recipientName: "Ava", shipDate: "2026-08-15", suggestedShipDate: "", status: "To Prepare", sourceRow: 2 };
  const seed = seedWith({ exceptions: [exception], summary: { ...seedWith().summary, mailingCount: 7 } });
  const unreviewed = computeImportData(seed, new Set(), null, null, "", false);
  assert.equal(unreviewed.mailingCount, 7);
  assert.equal(unreviewed.needsReviewCount, 1);

  const reviewed = computeImportData(seed, new Set(["MAIL-1::SUB-1::Missing email::2026-08-15"]), null, null, "", false);
  assert.equal(reviewed.needsReviewCount, 0);
});

test("computeImportData passes preview/importStatus/importBusy through unchanged", () => {
  const seed = seedWith();
  const preview = { seed, sheetName: "Sheet1", rowCount: 5, fileName: "test.xlsx" };
  const data = computeImportData(seed, new Set(), null, preview, "Preview ready.", true);
  assert.equal(data.preview, preview);
  assert.equal(data.importStatus, "Preview ready.");
  assert.equal(data.importBusy, true);
});

test("defaultAutomationRules prefers window.EVERLETTER_SEED, then the real seed, then an empty array", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = {};
    assert.deepEqual(defaultAutomationRules(null), []);
    assert.deepEqual(defaultAutomationRules(seedWith({ automationRules: [{ rule: "a", logic: "b" }] })), [{ rule: "a", logic: "b" }]);

    globalThis.window = { EVERLETTER_SEED: { automationRules: [{ rule: "fallback", logic: "c" }] } };
    assert.deepEqual(defaultAutomationRules(seedWith({ automationRules: [{ rule: "real", logic: "d" }] })), [{ rule: "fallback", logic: "c" }]);
  } finally {
    globalThis.window = originalWindow;
  }
});

function fakeXlsxFile(name, sheets) {
  const sheetNames = Object.keys(sheets);
  return {
    file: { name, arrayBuffer: async () => new ArrayBuffer(0) },
    xlsx: {
      read: () => ({ SheetNames: sheetNames, Sheets: Object.fromEntries(sheetNames.map((n) => [n, n])) }),
      utils: {
        sheet_to_json: (sheetKey) => sheets[sheetKey] || [],
      },
    },
  };
}

const ROW = {
  "Order ID": "5001",
  "Original Order Date": "2026-07-01",
  "Customer Name and Address": "Ava Example\n1 Main St, Sample City, ZZ 00000",
  Character: "Marley",
  "Letter Number": "1",
  "Ship Date": "2026-08-15",
  Subscription: "Month-to-month",
  Status: "To Prepare",
  "Active?": "Yes",
  Email: "ava@example.test",
};
const NOW = new Date("2026-08-01T12:00:00.000Z");

test("readWorkbookFile picks the sheet whose name contains 'mailing', case-insensitively, over the first sheet", async () => {
  const { file, xlsx } = fakeXlsxFile("schedule.xlsx", { Notes: [], "Mailing Schedule": [ROW] });
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { XLSX: xlsx };
    const preview = await readWorkbookFile(file, NOW, []);
    assert.equal(preview.sheetName, "Mailing Schedule");
    assert.equal(preview.rowCount, 1);
    assert.equal(preview.fileName, "schedule.xlsx");
    assert.equal(preview.seed.mailings.length, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("readWorkbookFile falls back to the first sheet when none has 'mailing' in its name", async () => {
  const { file, xlsx } = fakeXlsxFile("schedule.xlsx", { "Sheet1": [ROW] });
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { XLSX: xlsx };
    const preview = await readWorkbookFile(file, NOW, []);
    assert.equal(preview.sheetName, "Sheet1");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("readWorkbookFile rejects with a clear message when XLSX never loaded", async () => {
  const { file } = fakeXlsxFile("schedule.xlsx", { Sheet1: [ROW] });
  const originalWindow = globalThis.window;
  try {
    globalThis.window = {};
    await assert.rejects(() => readWorkbookFile(file, NOW, []), /Excel parser did not load/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("readWorkbookFile rejects when the worksheet has no rows at all", async () => {
  const { file, xlsx } = fakeXlsxFile("empty.xlsx", { Sheet1: [] });
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { XLSX: xlsx };
    await assert.rejects(() => readWorkbookFile(file, NOW, []), /worksheet looks empty/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("readWorkbookFile rejects when the workbook has no worksheets at all", async () => {
  const { file, xlsx } = fakeXlsxFile("blank.xlsx", {});
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { XLSX: xlsx };
    await assert.rejects(() => readWorkbookFile(file, NOW, []), /No worksheet found/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("readWorkbookFile rejects when the parsed rows contain no mailing rows", async () => {
  // A row with no recognizable columns at all still parses (as a mostly-
  // empty normalized row), but produces zero mailings - the same
  // "nothing usable in here" case buildSeedFromSpreadsheet itself guards.
  const { file, xlsx } = fakeXlsxFile("junk.xlsx", { Sheet1: [{ "Unrelated Column": "x" }] });
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { XLSX: xlsx };
    await assert.rejects(() => readWorkbookFile(file, NOW, []), /could not find any mailing rows/);
  } finally {
    globalThis.window = originalWindow;
  }
});
