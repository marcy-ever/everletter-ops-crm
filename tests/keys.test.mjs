import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mailingKey,
  componentKey,
  exceptionReviewKey,
  parseMailingKey,
  parseComponentKey,
  parseExceptionReviewKey,
} from "../lib/keys.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs the real public/app.js in a sandboxed vm context so its actual
// mailingKey/componentKey/exceptionReviewKey functions can be called
// directly - app.js can't be imported (non-bundled browser script), and
// lib/keys.ts is only trustworthy as a spec if it's verified against the
// real thing, not just eyeballed for a match.
function loadAppJsSandbox() {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

  function stubElement() {
    return {
      addEventListener() {},
      querySelector: () => stubElement(),
      querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {},
      dataset: {},
      getAttribute: () => null,
      setAttribute() {},
      set innerHTML(_value) {},
      get innerHTML() {
        return "";
      },
    };
  }

  const sandbox = {
    document: {
      querySelector: () => stubElement(),
      querySelectorAll: () => [],
    },
    window: {
      EVERLETTER_SEED: undefined,
      location: { hash: "" },
    },
    console,
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "public/app.js" }).runInContext(sandbox);
  return sandbox;
}

const appJs = loadAppJsSandbox();

test("app.js sandbox actually exposes the real key functions (sanity check)", () => {
  assert.equal(typeof appJs.mailingKey, "function");
  assert.equal(typeof appJs.componentKey, "function");
  assert.equal(typeof appJs.exceptionReviewKey, "function");
});

test("mailingKey matches app.js's real mailingKey for sample data", () => {
  const samples = [
    { mailingId: "MAIL-ABC123", sourceRow: 5 },
    { mailingId: "MAIL-XYZ-789", sourceRow: "12" },
    { mailingId: "MAIL-EDGE", sourceRow: 0 },
  ];
  for (const mailing of samples) {
    assert.equal(mailingKey(mailing), appJs.mailingKey(mailing));
  }
});

test("componentKey matches app.js's real componentKey for sample data", () => {
  const mailing = { mailingId: "MAIL-ABC123", sourceRow: 5 };
  const fields = ["envelope", "letter", "artifact", "insert", "location", "payment", "qa"];
  for (const field of fields) {
    assert.equal(componentKey(mailing, field), appJs.componentKey(mailing, field));
  }
});

test("exceptionReviewKey matches app.js's real exceptionReviewKey for sample data", () => {
  const samples = [
    { mailingId: "MAIL-1", subscriberId: "SUB-1", reason: "Missing ship date", shipDate: "2026-01-15" },
    { mailingId: "MAIL-2", subscriberId: "SUB-2", reason: "Missing recipient; Missing address", shipDate: "" },
    {},
    { mailingId: "MAIL-3" },
  ];
  for (const item of samples) {
    assert.equal(exceptionReviewKey(item), appJs.exceptionReviewKey(item));
  }
});

test("mailingKey produces the documented mailingId::sourceRow shape", () => {
  assert.equal(mailingKey({ mailingId: "MAIL-A", sourceRow: 7 }), "MAIL-A::7");
});

test("componentKey produces the documented mailingId::sourceRow::field shape", () => {
  assert.equal(componentKey({ mailingId: "MAIL-A", sourceRow: 7 }, "envelope"), "MAIL-A::7::envelope");
});

test("exceptionReviewKey falls back to placeholder strings for missing fields", () => {
  assert.equal(exceptionReviewKey({}), "unknown-mailing::unknown-subscriber::unknown-reason::no-ship-date");
});

test("parseMailingKey round-trips a well-formed key", () => {
  const key = mailingKey({ mailingId: "MAIL-A", sourceRow: 7 });
  assert.deepEqual(parseMailingKey(key), { mailingId: "MAIL-A", sourceRow: "7" });
});

test("parseMailingKey rejects malformed keys instead of guessing", () => {
  assert.equal(parseMailingKey("too::many::segments"), null);
  assert.equal(parseMailingKey("no-separator"), null);
  assert.equal(parseMailingKey(""), null);
  assert.equal(parseMailingKey("::"), null);
  assert.equal(parseMailingKey(undefined), null);
  assert.equal(parseMailingKey(null), null);
});

test("parseComponentKey round-trips a well-formed key", () => {
  const key = componentKey({ mailingId: "MAIL-A", sourceRow: 7 }, "envelope");
  assert.deepEqual(parseComponentKey(key), { mailingId: "MAIL-A", sourceRow: "7", field: "envelope" });
});

test("parseComponentKey rejects malformed keys instead of guessing", () => {
  assert.equal(parseComponentKey("MAIL-A::7"), null);
  assert.equal(parseComponentKey("MAIL-A::7::envelope::extra"), null);
  assert.equal(parseComponentKey(""), null);
});

test("parseExceptionReviewKey round-trips a well-formed key", () => {
  const key = exceptionReviewKey({
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    reason: "Missing ship date",
    shipDate: "2026-01-15",
  });
  assert.deepEqual(parseExceptionReviewKey(key), {
    mailingId: "MAIL-1",
    subscriberId: "SUB-1",
    reason: "Missing ship date",
    shipDate: "2026-01-15",
  });
});

test("parseExceptionReviewKey rejects malformed keys instead of guessing", () => {
  assert.equal(parseExceptionReviewKey("MAIL-1::SUB-1::reason-only-3-parts"), null);
  assert.equal(parseExceptionReviewKey(""), null);
  assert.equal(parseExceptionReviewKey(42), null);
});
