/**
 * Canonical spec for the subscriber/recipient/subscription/mailing ids
 * app.js generates client-side (buildSubscriberId/buildRecipientId/
 * buildSubscriptionId/buildMailingId in app/crm/legacy-app.js). app.js is a
 * real ES module now (the app.js -> ESM move, see CLAUDE.md), but doesn't
 * import this module - its own inline copies of these functions remain the
 * actual source of truth for what the browser sends. This module exists so
 * server-side write-to-tables code has a tested, parseable spec to match against, instead of re-deriving
 * the format ad hoc. tests/ids.test.mjs verifies this module's output is
 * identical to app.js's real functions for the same input.
 *
 * Each id is a hash of its input, not the raw input text, and each layer's
 * id is built from a hash of the layer below rather than re-embedding that
 * layer's raw text:
 * `PREFIX-${sha256Hex(slug(combinedString)).slice(0, ID_HASH_LENGTH)}`.
 * Two things this depends on:
 *  - Hashing instead of truncating raw text avoids collisions. A
 *    fixed-length truncation of raw text puts distinct records on the same
 *    id whenever the cutoff falls before whatever makes them different -
 *    concretely, 15 pairs of genuinely different recipients in the real
 *    spreadsheet (different names, sometimes different addresses entirely)
 *    would land on the same recipientId under a 22-character truncation,
 *    because the cutoff falls inside the shared subscriberId prefix before
 *    the recipient-specific name/address ever gets a chance to
 *    differentiate. subscriptionId carries the same risk one layer up
 *    (built from recipientId + character + plan) - see
 *    docs/schema-design.md's mailingId note for the same pattern found
 *    there independently. subscribers.id/subscriptions.id (and the
 *    equivalent columns for the other two entities) are Postgres `text`,
 *    unbounded - nothing downstream requires a particular id length, so
 *    there's no constraint pushing back toward truncation.
 *  - Hashing instead of embedding raw text keeps ids a fixed length.
 *    Embedding each layer's raw text would make ids grow with every layer
 *    - recipientId would carry subscriberId's raw text plus its own
 *    name/address, and subscriptionId/mailingId would inherit that bloat
 *    on top of their own. Hashing keeps every id `PREFIX-` plus a fixed
 *    24-character hex digest, regardless of how long the underlying
 *    name/address/character/plan text is.
 * slug() still runs first in both cases, so grouping/dedup behavior
 * (case-insensitive, diacritic-insensitive, same input fields) is
 * unaffected by hashing - only the final encoding differs, from slugged
 * text to a hex digest of that text. SHA-256 truncated to 24 hex
 * characters (96 bits) keeps collision probability astronomically below
 * anything this dataset's size could produce.
 *
 * sha256Hex is a pure-JS, synchronous, dependency-free implementation
 * (FIPS 180-4): app.js runs in the browser, where Node's crypto module
 * isn't available, and Web Crypto's subtle.digest is async-only, which
 * doesn't fit these functions' inline call sites during array-building.
 * The literal same implementation is vendored in both files (see the
 * comment in app/crm/legacy-app.js's copy) so they stay in sync;
 * tests/ids.test.mjs checks
 * output parity between the two, not source-text parity, since TS needs
 * type annotations JS doesn't have.
 */

function slug(value: string | null | undefined): string {
  return (
    String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

// Verified against Node's crypto.createHash('sha256') for empty/short/
// block-boundary (55-65 byte)/long/unicode inputs before being embedded
// here - see the module comment above.
function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const padLen = ((withOne + 8 + 63) & ~63) - withOne - 8;
  const total = withOne + padLen + 8;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[total - 8] = (hi >>> 24) & 0xff;
  buf[total - 7] = (hi >>> 16) & 0xff;
  buf[total - 6] = (hi >>> 8) & 0xff;
  buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff;
  buf[total - 3] = (lo >>> 16) & 0xff;
  buf[total - 2] = (lo >>> 8) & 0xff;
  buf[total - 1] = lo & 0xff;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

const ID_HASH_LENGTH = 24;

export interface SubscriberIdInput {
  email?: string | null;
  recipientName: string;
  address: string;
}

export interface RecipientIdInput {
  subscriberId: string;
  recipientName: string;
  address: string;
}

export interface SubscriptionIdInput {
  recipientId: string;
  character: string;
  plan: string;
}

export interface MailingIdInput {
  orderId: string;
  recipientId: string;
  character: string;
  letterNumber?: string | number | null;
  sourceRow: string | number;
}

export function buildSubscriberId({ email, recipientName, address }: SubscriberIdInput): string {
  const subscriberKey = email || `${slug(recipientName)}-${slug(address)}`;
  return `SUB-${sha256Hex(slug(subscriberKey)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}

export function buildRecipientId({ subscriberId, recipientName, address }: RecipientIdInput): string {
  const recipientKey = `${subscriberId}-${slug(recipientName)}-${slug(address)}`;
  return `REC-${sha256Hex(slug(recipientKey)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}

export function buildSubscriptionId({ recipientId, character, plan }: SubscriptionIdInput): string {
  return `PLAN-${sha256Hex(slug(`${recipientId}-${character}-${plan}`)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}

export function buildMailingId({ orderId, recipientId, character, letterNumber, sourceRow }: MailingIdInput): string {
  return `MAIL-${sha256Hex(slug(`${orderId}-${recipientId}-${character}-${letterNumber || sourceRow}`)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}
