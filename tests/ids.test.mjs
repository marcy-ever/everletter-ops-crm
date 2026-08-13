import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubscriberId, buildRecipientId, buildSubscriptionId, buildMailingId } from "../lib/ids.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs the real public/app.js in a sandboxed vm context so its actual
// buildSubscriberId/buildRecipientId/buildSubscriptionId/buildMailingId
// functions can be called directly - app.js can't be imported (non-bundled
// browser script), and lib/ids.ts is only trustworthy as a spec if it's
// verified against the real thing, not just eyeballed for a match. Same
// technique as tests/keys.test.mjs.
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
    // Real browsers provide TextEncoder as a global (used by sha256Hex to
    // get UTF-8 bytes); vm.createContext doesn't inherit it from the
    // outer Node process the way it doesn't inherit fetch either.
    TextEncoder,
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "public/app.js" }).runInContext(sandbox);
  return sandbox;
}

const appJs = loadAppJsSandbox();

test("app.js sandbox actually exposes the real id functions (sanity check)", () => {
  assert.equal(typeof appJs.buildSubscriberId, "function");
  assert.equal(typeof appJs.buildRecipientId, "function");
  assert.equal(typeof appJs.buildSubscriptionId, "function");
  assert.equal(typeof appJs.buildMailingId, "function");
});

test("buildSubscriberId matches app.js's real buildSubscriberId for sample data", () => {
  const samples = [
    { email: "marcy@theeverletter.com", recipientName: "Marcy Example", address: "1 Main St" },
    { email: "", recipientName: "No Email Person", address: "2 Oak Ave" },
    { email: null, recipientName: "Café Résumé", address: "3 Elm St" },
    { email: "a@b.com", recipientName: "", address: "" },
  ];
  for (const input of samples) {
    assert.equal(buildSubscriberId(input), appJs.buildSubscriberId(input));
  }
});

test("buildRecipientId matches app.js's real buildRecipientId for sample data", () => {
  const samples = [
    { subscriberId: "SUB-EXAMPLE", recipientName: "Karsyn Duquaine", address: "4231 S Sunburst Ln" },
    { subscriberId: "SUB-EXAMPLE", recipientName: "Dorothy Fitzgerald", address: "526 1st St" },
    { subscriberId: "SUB-X", recipientName: "", address: "" },
  ];
  for (const input of samples) {
    assert.equal(buildRecipientId(input), appJs.buildRecipientId(input));
  }
});

test("buildSubscriptionId matches app.js's real buildSubscriptionId for sample data", () => {
  const samples = [
    { recipientId: "REC-EXAMPLE", character: "Marley", plan: "Month-to-month" },
    { recipientId: "REC-EXAMPLE", character: "Mothers Day", plan: "One-time" },
    { recipientId: "REC-X", character: "", plan: "" },
  ];
  for (const input of samples) {
    assert.equal(buildSubscriptionId(input), appJs.buildSubscriptionId(input));
  }
});

test("buildMailingId matches app.js's real buildMailingId for sample data", () => {
  const samples = [
    { orderId: "ORD-1001", recipientId: "REC-EXAMPLE", character: "Marley", letterNumber: "3", sourceRow: 12 },
    { orderId: "ORD-1002", recipientId: "REC-EXAMPLE", character: "Oliver", letterNumber: "", sourceRow: 99 },
    { orderId: "ORD-MISSING-5", recipientId: "REC-X", character: "", letterNumber: null, sourceRow: 5 },
  ];
  for (const input of samples) {
    assert.equal(buildMailingId(input), appJs.buildMailingId(input));
  }
});

test("ids stay short and bounded regardless of input length (hashed, not embedded raw)", () => {
  // Regression guard for the id-length bug: these ids used to embed their
  // raw slugged input text (and each layer re-embedded the layer below),
  // so length grew unboundedly with input length. Hashing means length is
  // now constant - PREFIX- (varies) + a fixed 24-char hex digest - no
  // matter how long the underlying name/address/character/plan text is.
  const longName = "A Very Long Recipient Name That Keeps Going And Going And Going";
  const longAddress = "1234 An Extremely Long Street Name Boulevard Avenue, Some City, ST 99999";

  const subscriberId = buildSubscriberId({ email: "", recipientName: longName, address: longAddress });
  assert.equal(subscriberId.length, "SUB-".length + 24, `expected a fixed-length id, got ${subscriberId.length} chars: ${subscriberId}`);
  assert.equal(subscriberId, appJs.buildSubscriberId({ email: "", recipientName: longName, address: longAddress }));

  const recipientId = buildRecipientId({ subscriberId, recipientName: longName, address: longAddress });
  assert.equal(recipientId.length, "REC-".length + 24, `expected a fixed-length id, got ${recipientId.length} chars: ${recipientId}`);
  assert.equal(
    recipientId,
    appJs.buildRecipientId({ subscriberId, recipientName: longName, address: longAddress }),
  );
});

test("ids are deterministic - same input always produces the same id (load-bearing for re-import upserts)", () => {
  const input = { email: "repeat@example.com", recipientName: "Repeat Person", address: "1 Repeat St" };
  const first = buildSubscriberId(input);
  for (let i = 0; i < 5; i++) {
    assert.equal(buildSubscriberId({ ...input }), first);
    assert.equal(appJs.buildSubscriberId({ ...input }), first);
  }
});

test("buildRecipientId no longer collides two different real recipients sharing a long subscriberId prefix", () => {
  // Regression case for the actual bug found in the real spreadsheet: two
  // different people under the same subscriber account, whose old 22-char
  // truncation landed inside the shared subscriberId prefix before either
  // recipient's own name/address could differentiate them.
  const subscriberId = buildSubscriberId({
    email: "bridgette.duquaine@aah.org",
    recipientName: "unused",
    address: "unused",
  });
  const a = buildRecipientId({ subscriberId, recipientName: "Miss Karsyn Duquaine", address: "4231 S Sunburst Lane" });
  const b = buildRecipientId({ subscriberId, recipientName: "Dorothy Fitzgerald", address: "526 1st Street" });
  assert.notEqual(a, b);
  assert.equal(a, appJs.buildRecipientId({ subscriberId, recipientName: "Miss Karsyn Duquaine", address: "4231 S Sunburst Lane" }));
  assert.equal(b, appJs.buildRecipientId({ subscriberId, recipientName: "Dorothy Fitzgerald", address: "526 1st Street" }));
});

test("buildSubscriptionId no longer collides two different characters/plans for the same recipient", () => {
  // Regression case for the Bridgette Duquaine bug reported earlier: two
  // orders for the same recipient, different character and plan, whose old
  // 28-char truncation collided onto one subscriptionId.
  const recipientId = "REC-SUB-BRIDGETTE-DUQUAINE";
  const a = buildSubscriptionId({ recipientId, character: "Mothers Day", plan: "One-time" });
  const b = buildSubscriptionId({ recipientId, character: "Marley", plan: "Month-to-month" });
  assert.notEqual(a, b);
});
