const viewNames = new Set(['queue', 'exceptions', 'subscribers', 'import', 'print', 'qa', 'packet', 'bins', 'launch', 'samples', 'sync', 'automation']);

// activeView/reviewed/statusOverrides/componentOverrides start as inert
// defaults here (module evaluation must stay side-effect-free - see
// initCrmApp() at the bottom) and are set to their real, DOM/localStorage-
// derived values by initCrmApp() before anything renders.
const state = {
  activeView: 'queue',
  query: '',
  statusFilter: 'Open',
  batchFilter: 'next',
  printScope: 'monthly',
  printStockFilter: 'all',
  packetScope: 'all',
  syncSubscriberId: '',
  syncSubscriptionId: '',
  syncPlan: 'Month-to-month',
  syncOrderDate: '2026-07-12',
  sampleType: 'Kid',
  selectedSubscriberId: '',
  importPreview: null,
  importStatus: '',
  importBusy: false,
  importInfo: null,
  reviewed: new Set(),
  statusOverrides: {},
  componentOverrides: {},
  seed: null,
};

const openStatuses = new Set(['To Prepare', 'Printing', 'Assembling', 'Ready to Mail']);
const statusOrder = ['To Prepare', 'Printing', 'Assembling', 'Ready to Mail', 'Mailed'];

// Shared with lib/mailing-rules.ts (tests/mailing-rules.test.mjs verifies
// that copy matches these real functions exactly - see the comment there
// for why app.js can't import it directly). Extracted so this logic has one
// definition instead of being reimplemented ad hoc anywhere else that needs
// it - the same reasoning behind extracting buildSubscriberId/mailingKey/etc.
function isOpenStatus(status) {
  return openStatuses.has(status);
}

function isOverdueMailing(mailing, today) {
  return mailing.activeState === 'Active' && isOpenStatus(mailing.status) && !!mailing.shipDate && mailing.shipDate < today;
}

function isDueNext14Days(mailing, today) {
  if (mailing.activeState !== 'Active' || !isOpenStatus(mailing.status) || !mailing.shipDate) return false;
  const delta = daysBetween(today, mailing.shipDate);
  return delta >= 0 && delta <= 14;
}
const qaFields = [
  { key: 'payment', label: 'Payment', options: ['Active', 'Needs Check', 'CC Failed', 'Paused'] },
  { key: 'envelope', label: 'Envelope', options: ['Need Print', 'Printed', 'Both Printed', 'In Ashley Box', 'Not Needed'] },
  { key: 'letter', label: 'Letter', options: ['Need Print', 'Printed', 'Stuffed', 'Not Needed'] },
  { key: 'artifact', label: 'Artifact', options: ['Need Check', 'Packed', 'Not Needed'] },
  { key: 'insert', label: 'Map / Insert', options: ['Need Check', 'Packed', 'Not Needed'] },
  { key: 'location', label: 'Location', options: ['Marcy', 'Ashley', 'Batch Bin', 'Mailed'] },
  { key: 'qa', label: 'QA', options: ['Open', 'Problem', 'Ready'] },
];
const driveConfig = {
  printReadyFolderUrl: '',
  characterFolders: {
    harper: '',
    legends: '',
    marigold: '',
    marley: '',
    'mothers day': '',
    oliver: '',
    penelope: '',
    ringo: '',
    seraphine: '',
  },
  envelopeFolders: {
    harper: '',
    legends: '',
    marigold: '',
    marley: '',
    oliver: '',
    penelope: '',
    ringo: '',
    seraphine: '',
  },
  letterFolders: {
    legends: {
      3: '',
    },
    marigold: {
      1: '',
      4: '',
      10: '',
    },
    penelope: {
      6: '',
      7: '',
      8: '',
      10: '',
    },
  },
};

// Assigned by initCrmApp() (module evaluation must stay side-effect-free -
// see that function at the bottom). Declared here, at module scope, because
// every render function below closes over these same bindings by name.
let topbarMeta, metrics, statusStrip, viewMount, searchInput, statusFilter, statusFilterWrap, batchFilter, batchFilterWrap, pastBatchFilter, pastBatchFilterWrap;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return 'Needs date';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function includesText(values, query) {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
}

function statusClass(status) {
  return String(status).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function loadStatusOverrides() {
  try {
    return JSON.parse(localStorage.getItem('everletterStatusOverrides') || '{}');
  } catch {
    return {};
  }
}

function saveStatusOverrides() {
  localStorage.setItem('everletterStatusOverrides', JSON.stringify(state.statusOverrides));
}

function saveSharedState(kind, key, value) {
  fetch('/api/shared-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, key, value }),
  }).catch(() => {
    // Keep local changes usable if the shared endpoint is briefly unavailable.
  });
}

async function saveSharedDataset(seed, sourceName) {
  const payload = {
    seed,
    sourceName,
    uploadedAt: new Date().toISOString(),
    summary: seed.summary,
  };
  const response = await fetch('/api/shared-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'crmDataset', key: 'current', value: JSON.stringify(payload) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Could not save the imported spreadsheet.');
  }
  state.importInfo = payload;
  return payload;
}

async function loadSharedState() {
  const response = await fetch('/api/shared-state', { cache: 'no-store' });
  if (!response.ok) return;

  const shared = await response.json();
  if (shared.dataset?.summary) {
    state.seed = shared.dataset;
  }
  if (shared.statusOverrides && typeof shared.statusOverrides === 'object') {
    state.statusOverrides = { ...state.statusOverrides, ...shared.statusOverrides };
    saveStatusOverrides();
  }
  if (shared.componentOverrides && typeof shared.componentOverrides === 'object') {
    state.componentOverrides = { ...state.componentOverrides, ...shared.componentOverrides };
    saveComponentOverrides();
  }
  if (Array.isArray(shared.reviewed)) {
    shared.reviewed.forEach((key) => state.reviewed.add(key));
    saveReviewedExceptions();
  }
}

function loadComponentOverrides() {
  try {
    return JSON.parse(localStorage.getItem('everletterComponentOverrides') || '{}');
  } catch {
    return {};
  }
}

function saveComponentOverrides() {
  localStorage.setItem('everletterComponentOverrides', JSON.stringify(state.componentOverrides));
}

function loadReviewedExceptions() {
  try {
    return new Set(JSON.parse(localStorage.getItem('everletterReviewedExceptions') || '[]'));
  } catch {
    return new Set();
  }
}

function saveReviewedExceptions() {
  localStorage.setItem('everletterReviewedExceptions', JSON.stringify(Array.from(state.reviewed)));
}

function mailingKey(mailing) {
  return `${mailing.mailingId}::${mailing.sourceRow}`;
}

function exceptionReviewKey(item) {
  return [
    item.mailingId || 'unknown-mailing',
    item.subscriberId || 'unknown-subscriber',
    item.reason || 'unknown-reason',
    item.shipDate || 'no-ship-date',
  ].join('::');
}

function isExceptionReviewed(item) {
  return state.reviewed.has(exceptionReviewKey(item)) || state.reviewed.has(item.exceptionId);
}

function activeExceptions() {
  return state.seed.exceptions.filter((item) => !isExceptionReviewed(item));
}

function componentKey(mailing, field) {
  return `${mailingKey(mailing)}::${field}`;
}

function effectiveMailing(mailing) {
  return {
    ...mailing,
    originalStatus: mailing.status,
    status: state.statusOverrides[mailingKey(mailing)] || mailing.status,
  };
}

function effectiveMailings() {
  return state.seed.mailings.map(effectiveMailing);
}

function updateMailingStatus(mailing, status) {
  const key = mailingKey(mailing);
  state.statusOverrides[key] = status;
  saveStatusOverrides();
  saveSharedState('mailingStatus', key, status);
}

function updateComponentStatus(mailing, field, status) {
  const key = componentKey(mailing, field);
  state.componentOverrides[key] = status;
  saveComponentOverrides();
  saveSharedState('componentStatus', key, status);
}

function mailingMonthKey(mailing) {
  return String(mailing.shipDate || '').slice(0, 7);
}

function envelopeQuantityForMailing(mailing) {
  return mailing.plan === 'Month-to-month' ? 2 : 1;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

// Pure-JS, synchronous, dependency-free SHA-256 (FIPS 180-4). app.js is a
// non-bundled <script> - no crypto module, and Web Crypto's subtle.digest
// is async-only, which doesn't fit these functions' inline call sites. The
// literal same implementation is vendored in lib/ids.ts so the two stay in
// sync; tests/ids.test.mjs checks output parity, not source-text parity
// (TS needs type annotations JS doesn't have), so this copy is the actual
// source of truth for what ships to the browser. Verified against Node's
// crypto.createHash('sha256') for empty/short/block-boundary (55-65 byte)/
// long/unicode inputs before being embedded here.
function sha256Hex(message) {
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
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

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

  const toHex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

const ID_HASH_LENGTH = 24;

// Identity for subscribers/recipients/subscriptions/mailings, shared with
// lib/ids.ts (tests/ids.test.mjs verifies that copy matches these real
// functions exactly - see the history comment there for why these hash
// their inputs instead of embedding them raw, and why app.js can't import
// lib/ids.ts directly). Each combines the exact same fields as before -
// only the encoding of the result changed, from raw slugged text to a
// truncated SHA-256 hex digest of that same text, so grouping/dedup
// behavior (case-insensitive, diacritic-insensitive, same fields) is
// unchanged.
function buildSubscriberId({ email, recipientName, address }) {
  const subscriberKey = email || `${slug(recipientName)}-${slug(address)}`;
  return `SUB-${sha256Hex(slug(subscriberKey)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}

function buildRecipientId({ subscriberId, recipientName, address }) {
  const recipientKey = `${subscriberId}-${slug(recipientName)}-${slug(address)}`;
  return `REC-${sha256Hex(slug(recipientKey)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}

function buildSubscriptionId({ recipientId, character, plan }) {
  return `PLAN-${sha256Hex(slug(`${recipientId}-${character}-${plan}`)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}

function buildMailingId({ orderId, recipientId, character, letterNumber, sourceRow }) {
  return `MAIL-${sha256Hex(slug(`${orderId}-${recipientId}-${character}-${letterNumber || sourceRow}`)).slice(0, ID_HASH_LENGTH).toUpperCase()}`;
}

function compactOrderNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d+\.0$/.test(raw)) return raw.replace(/\.0$/, '');
  return raw;
}

function compactNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d+\.0$/.test(raw)) return raw.replace(/\.0$/, '');
  return raw;
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeSpreadsheetRow(row) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[normalizeHeader(key)] = value;
  });
  return normalized;
}

function getSpreadsheetValue(row, ...names) {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function spreadsheetDateToIso(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return '';
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  return '';
}

function splitNameAddress(block) {
  const lines = String(block || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    name: lines[0] || 'Unknown recipient',
    address: lines.slice(1).join(', ').replace(/\s+/g, ' ').trim(),
  };
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return false;
  return ['true', 'yes', 'y', '1', 'active', 'checked'].includes(raw);
}

function normalizePlan(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return 'Needs Review';
  if (lower.includes('12')) return '12-month';
  if (lower.includes('6')) return '6-month';
  if (lower.includes('month') || lower.includes('renewal')) return 'Month-to-month';
  if (lower.includes('one') || lower.includes('sample') || lower.includes('1')) return 'One-time';
  return raw;
}

function normalizeCharacter(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Needs Review';
  const lower = raw.toLowerCase();
  const known = ['marley', 'ringo', 'oliver', 'harper', 'penelope', 'marigold', 'seraphine', 'legends'];
  if (lower.includes('old marley')) return 'Old Marley';
  const found = known.find((name) => lower.includes(name));
  if (found) return found.charAt(0).toUpperCase() + found.slice(1);
  return raw;
}

function normalizeStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'To Prepare';
  const lower = raw.toLowerCase();
  if (lower.includes('print')) return 'Printing';
  if (lower.includes('assem')) return 'Assembling';
  if (lower.includes('ready')) return 'Ready to Mail';
  if (lower.includes('mail')) return 'Mailed';
  if (lower.includes('prepare') || lower.includes('prep')) return 'To Prepare';
  return raw;
}

function monthKey(dateValue) {
  return dateValue ? String(dateValue).slice(0, 7) : '';
}

function nearestBatchDate(dateValue) {
  if (!dateValue) return '';
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  if (day === 1 || day === 15) return dateValue;
  if (day < 8) date.setDate(1);
  else if (day < 23) date.setDate(15);
  else {
    date.setMonth(date.getMonth() + 1);
    date.setDate(1);
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function daysBetween(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function defaultAutomationRules() {
  return window.EVERLETTER_SEED?.automationRules || state.seed?.automationRules || [];
}

function spreadsheetExceptionReasons(row, activeState) {
  const reasons = [];
  if (!row.recipientName || row.recipientName === 'Unknown recipient') reasons.push('Missing recipient');
  if (!row.address) reasons.push('Missing address');
  if (!row.email) reasons.push('Missing email');
  if (!row.character || row.character === 'Needs Review') reasons.push('Missing character');
  if (!row.plan || row.plan === 'Needs Review') reasons.push('Missing subscription');
  if (!row.shipDate) reasons.push('Missing ship date');
  if (row.shipDate) {
    const day = Number(row.shipDate.slice(-2));
    if (![1, 15].includes(day)) reasons.push('Ship date is not a 1st/15th batch');
  }
  if (activeState === 'Active' && row.status === 'Mailed' && row.shipDate && row.shipDate > todayIso()) {
    reasons.push('Future mailing already marked mailed');
  }
  return reasons;
}

function buildSeedFromSpreadsheet(rows, sourceName) {
  const normalizedRows = rows
    .map((raw, index) => ({ raw: normalizeSpreadsheetRow(raw), sourceRow: index + 2 }))
    .map(({ raw, sourceRow }) => {
      const customerBlock = getSpreadsheetValue(raw, 'Customer Name and Address', 'Customer Name/Address', 'Name and Address');
      const recipient = splitNameAddress(customerBlock);
      const orderNumber = compactOrderNumber(getSpreadsheetValue(raw, 'Order ID', 'Order Number'));
      const orderDate = spreadsheetDateToIso(getSpreadsheetValue(raw, 'Original Order Date', 'Original Order date', 'Order Date'));
      const shipDate = spreadsheetDateToIso(getSpreadsheetValue(raw, 'Ship Date', 'Mailing Date'));
      const endDate = spreadsheetDateToIso(getSpreadsheetValue(raw, 'End Date', 'End date'));
      return {
        sourceRow,
        orderNumber,
        orderDate,
        endDate,
        recipientName: recipient.name,
        address: recipient.address,
        character: normalizeCharacter(getSpreadsheetValue(raw, 'Character')),
        letterNumber: compactNumber(getSpreadsheetValue(raw, 'Letter Number', 'Letter #')),
        shipDate,
        suggestedShipDate: nearestBatchDate(shipDate),
        plan: normalizePlan(getSpreadsheetValue(raw, 'Subscription', 'Plan')),
        status: normalizeStatus(getSpreadsheetValue(raw, 'Status')),
        notes: String(getSpreadsheetValue(raw, 'Notes') || '').trim(),
        active: normalizeBoolean(getSpreadsheetValue(raw, 'Active?', 'Active')),
        email: String(getSpreadsheetValue(raw, 'Email', 'Customer Email') || '').trim().toLowerCase(),
      };
    })
    .filter((row) => row.orderNumber || row.recipientName !== 'Unknown recipient' || row.email || row.shipDate);

  const subscribers = new Map();
  const recipients = new Map();
  const orders = new Map();
  const subscriptions = new Map();
  const mailings = [];
  const exceptions = [];
  const today = todayIso();

  normalizedRows.forEach((row) => {
    const subscriberId = buildSubscriberId({ email: row.email, recipientName: row.recipientName, address: row.address });
    const recipientId = buildRecipientId({ subscriberId, recipientName: row.recipientName, address: row.address });
    const orderId = row.orderNumber ? `ORD-${row.orderNumber}` : `ORD-MISSING-${row.sourceRow}`;
    const subscriptionId = buildSubscriptionId({ recipientId, character: row.character, plan: row.plan });
    const activeState = row.active ? 'Active' : 'Archived';
    const mailingId = buildMailingId({ orderId, recipientId, character: row.character, letterNumber: row.letterNumber, sourceRow: row.sourceRow });

    if (!subscribers.has(subscriberId)) {
      subscribers.set(subscriberId, {
        subscriberId,
        email: row.email,
        displayName: row.recipientName,
        status: activeState,
        firstOrderDate: row.orderDate,
        openMailings: 0,
        totalMailings: 0,
        nextShipDate: '',
        issueCount: 0,
      });
    }

    if (!recipients.has(recipientId)) {
      recipients.set(recipientId, {
        recipientId,
        subscriberId,
        name: row.recipientName,
        address: row.address,
        characters: new Set(),
        totalMailings: 0,
        nextShipDate: '',
      });
    }

    if (!orders.has(orderId)) {
      orders.set(orderId, {
        orderId,
        subscriberId,
        sourceOrderNumber: row.orderNumber,
        createdOn: row.orderDate,
        billingMonth: monthKey(row.orderDate),
        plan: row.plan,
        status: 'Imported',
        amount: '',
      });
    }

    if (!subscriptions.has(subscriptionId)) {
      subscriptions.set(subscriptionId, {
        subscriptionId,
        subscriberId,
        recipientId,
        plan: row.plan,
        character: row.character,
        startDate: row.orderDate,
        endDate: row.endDate,
        activeState,
        generatedMailings: 0,
      });
    }

    const mailing = {
      mailingId,
      subscriberId,
      recipientId,
      orderId,
      orderDate: row.orderDate,
      subscriptionId,
      recipientName: row.recipientName,
      email: row.email,
      character: row.character,
      plan: row.plan,
      letterNumber: row.letterNumber,
      shipDate: row.shipDate,
      suggestedShipDate: row.suggestedShipDate,
      status: row.status,
      activeState,
      notes: row.notes,
      overdue: isOverdueMailing({ activeState, status: row.status, shipDate: row.shipDate }, today),
      dueNext14Days: isDueNext14Days({ activeState, status: row.status, shipDate: row.shipDate }, today),
      sourceRow: row.sourceRow,
    };
    mailings.push(mailing);

    const subscriber = subscribers.get(subscriberId);
    const recipient = recipients.get(recipientId);
    const subscription = subscriptions.get(subscriptionId);
    subscriber.totalMailings += 1;
    recipient.totalMailings += 1;
    subscription.generatedMailings += 1;
    recipient.characters.add(mailing.character);

    if (activeState === 'Active' && isOpenStatus(mailing.status)) {
      subscriber.openMailings += 1;
      if (mailing.shipDate && (!subscriber.nextShipDate || mailing.shipDate < subscriber.nextShipDate)) subscriber.nextShipDate = mailing.shipDate;
      if (mailing.shipDate && (!recipient.nextShipDate || mailing.shipDate < recipient.nextShipDate)) recipient.nextShipDate = mailing.shipDate;
    }

    const reasons = spreadsheetExceptionReasons(row, activeState);
    if (activeState === 'Active' && reasons.length) {
      subscriber.issueCount += 1;
      exceptions.push({
        exceptionId: `EX-${row.sourceRow}`,
        severity: reasons.some((reason) => reason.includes('Missing') || reason.includes('ship date')) ? 'High' : 'Low',
        reason: reasons.join('; '),
        mailingId: mailing.mailingId,
        subscriberId,
        recipientName: mailing.recipientName,
        shipDate: mailing.shipDate,
        suggestedShipDate: reasons.some((reason) => reason.toLowerCase().includes('ship date')) ? mailing.suggestedShipDate : '',
        status: mailing.status,
        sourceRow: row.sourceRow,
      });
    }
  });

  const normalizedRecipients = Array.from(recipients.values()).map((recipient) => ({
    ...recipient,
    characters: Array.from(recipient.characters).sort(),
  }));
  const subscriberRows = Array.from(subscribers.values());

  const summary = {
    asOf: today,
    sourceFile: sourceName,
    subscriberCount: subscribers.size,
    activeSubscriberCount: subscriberRows.filter((subscriber) => subscriber.status === 'Active').length,
    archivedSubscriberCount: subscriberRows.filter((subscriber) => subscriber.status !== 'Active').length,
    recipientCount: recipients.size,
    orderCount: orders.size,
    subscriptionCount: subscriptions.size,
    mailingCount: mailings.length,
    openMailingCount: mailings.filter((mailing) => mailing.activeState === 'Active' && isOpenStatus(mailing.status)).length,
    archivedMailingCount: mailings.filter((mailing) => mailing.activeState !== 'Active').length,
    overdueCount: mailings.filter((mailing) => mailing.activeState === 'Active' && mailing.overdue).length,
    dueNext14Count: mailings.filter((mailing) => mailing.activeState === 'Active' && mailing.dueNext14Days).length,
    exceptionCount: exceptions.length,
    missingShipDateCount: exceptions.filter((item) => item.reason.includes('ship date')).length,
  };

  return {
    summary,
    subscribers: subscriberRows.sort((a, b) => (a.nextShipDate || '9999').localeCompare(b.nextShipDate || '9999')),
    recipients: normalizedRecipients.sort((a, b) => a.name.localeCompare(b.name)),
    orders: Array.from(orders.values()).sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn))),
    subscriptions: Array.from(subscriptions.values()).sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId)),
    mailings: mailings.sort((a, b) => (a.shipDate || '9999').localeCompare(b.shipDate || '9999')),
    exceptions: exceptions.sort((a, b) => (b.severity.localeCompare(a.severity) || (a.shipDate || '').localeCompare(b.shipDate || ''))),
    automationRules: defaultAutomationRules(),
  };
}

async function readWorkbookFile(file) {
  if (!window.XLSX) throw new Error('The Excel parser did not load. Refresh the CRM and try again.');
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes('mailing')) || workbook.SheetNames[0];
  if (!sheetName) throw new Error('No worksheet found in that file.');
  // blankrows:true keeps fully-blank sheet rows in the array so sourceRow
  // (index+2 in buildSeedFromSpreadsheet) always lines up with the real
  // physical spreadsheet row; the content-based filter in
  // buildSeedFromSpreadsheet drops these blank rows afterward on its own.
  const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: true, blankrows: true });
  if (!rows.length) throw new Error('That worksheet looks empty.');
  const seed = buildSeedFromSpreadsheet(rows, file.name);
  if (!seed.mailings.length) throw new Error('I could not find any mailing rows in that sheet.');
  return { seed, sheetName, rowCount: rows.length };
}

function printedEnvelopeStatusForMailing(mailing) {
  return envelopeQuantityForMailing(mailing) > 1 ? 'Both Printed' : 'Printed';
}

function monthlyEnvelopeTargets(mailing) {
  if (mailing.plan !== 'Month-to-month' || !mailing.subscriptionId || !mailing.shipDate) return [mailing];
  const monthKey = mailingMonthKey(mailing);
  const targets = effectiveMailings().filter((item) => (
    item.plan === 'Month-to-month'
    && item.subscriptionId === mailing.subscriptionId
    && mailingMonthKey(item) === monthKey
  ));
  return targets.length ? targets : [mailing];
}

function updateEnvelopeStatus(mailing, status) {
  monthlyEnvelopeTargets(mailing).forEach((target) => updateComponentStatus(target, 'envelope', status));
}

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function availableBatchDates() {
  const today = todayIso();
  const dates = Array.from(new Set(
    effectiveMailings()
      .filter((mailing) => mailing.activeState === 'Active' && isOpenStatus(mailing.status) && mailing.shipDate && mailing.shipDate >= today)
      .map((mailing) => mailing.shipDate),
  )).sort();
  return dates;
}

function pastBatchDates() {
  const today = todayIso();
  return Array.from(new Set(
    effectiveMailings()
      .filter((mailing) => mailing.activeState === 'Active' && mailing.shipDate && mailing.shipDate < today)
      .map((mailing) => mailing.shipDate),
  )).sort().reverse();
}

function nextBatchDate() {
  const today = todayIso();
  const upcoming = availableBatchDates().find((date) => date >= today);
  return upcoming || availableBatchDates()[0] || '';
}

function selectedBatchDate() {
  if (state.batchFilter === 'next') return nextBatchDate();
  if (state.batchFilter === 'all') return '';
  return state.batchFilter;
}

function renderBatchFilter() {
  const dates = availableBatchDates();
  const nextDate = nextBatchDate();
  const pastDates = pastBatchDates();
  const selectedPastDate = pastDates.includes(state.batchFilter) ? state.batchFilter : '';
  const options = [
    `<option value="next" ${state.batchFilter === 'next' ? 'selected' : ''}>Next batch: ${formatDate(nextDate)}</option>`,
    `<option value="all" ${state.batchFilter === 'all' ? 'selected' : ''}>All open batches</option>`,
    selectedPastDate ? `<option value="${escapeHtml(selectedPastDate)}" selected>Past batch: ${formatDate(selectedPastDate)}</option>` : '',
    ...dates.map((date) => `<option value="${escapeHtml(date)}" ${state.batchFilter === date ? 'selected' : ''}>${formatDate(date)}</option>`),
  ];
  batchFilter.innerHTML = options.join('');
  pastBatchFilter.innerHTML = [
    '<option value="">Past batches...</option>',
    ...pastDates.map((date) => `<option value="${escapeHtml(date)}" ${selectedPastDate === date ? 'selected' : ''}>${formatDate(date)}</option>`),
  ].join('');
  statusFilter.value = state.statusFilter;
}

function renderShell() {
  const { seed } = state;
  const openExceptionCount = activeExceptions().length;
  const activeMailings = effectiveMailings().filter((mailing) => mailing.activeState === 'Active');
  const openMailingCount = activeMailings.filter((mailing) => isOpenStatus(mailing.status)).length;
  topbarMeta.innerHTML = `
    <span>Imported ${formatDate(seed.summary.asOf)}</span>
    <span>${number(seed.summary.mailingCount)} mailings</span>
  `;

  metrics.innerHTML = [
    metric('â—Ž', 'Active subscribers', seed.summary.activeSubscriberCount ?? seed.summary.subscriberCount, 'blue'),
    metric('âœ‰', 'Open mailings', openMailingCount, 'green'),
    metric('â—·', 'Due next 14 days', seed.summary.dueNext14Count, 'amber'),
    metric('!', 'Needs review', openExceptionCount, 'rose'),
  ].join('');

  statusStrip.innerHTML = statusOrder
    .map((status) => {
      const count = effectiveMailings().filter((mailing) => mailing.status === status).length;
      const width = Math.max(8, (count / seed.summary.mailingCount) * 100);
      return `
        <div class="status-meter">
          <div><span>${escapeHtml(status)}</span><strong>${number(count)}</strong></div>
          <div class="meter-track"><span style="width:${width}%"></span></div>
        </div>
      `;
    })
    .join('');
  renderBatchFilter();
}

function metric(icon, label, value, tone) {
  return `
    <div class="metric metric-${tone}">
      <div class="metric-icon">${icon}</div>
      <span>${escapeHtml(label)}</span>
      <strong>${number(value)}</strong>
    </div>
  `;
}

function renderQueue() {
  const highExceptionMailingIds = new Set(
    activeExceptions()
      .filter((item) => item.severity === 'High')
      .map((item) => item.mailingId),
  );
  const batchDate = selectedBatchDate();
  const rows = effectiveMailings()
    .filter((mailing) => mailing.activeState === 'Active')
    .filter((mailing) => !highExceptionMailingIds.has(mailing.mailingId))
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => (state.statusFilter === 'Open' ? isOpenStatus(mailing.status) : state.statusFilter === 'All' ? true : mailing.status === state.statusFilter))
    .filter((mailing) =>
      includesText(
        [mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId],
        state.query,
      ),
    )
    .slice(0, 120);

  viewMount.innerHTML = `
    <section class="data-panel" aria-label="Production queue">
      <div class="panel-head">
        <div>
          <h3>${batchDate ? `${formatDate(batchDate)} Mail Batch` : 'Production Queue'}</h3>
          <p>Active subscribers only. Use the batch filter to focus on the immediate 1st/15th mailing.</p>
        </div>
        <span class="panel-count">${rows.length} shown</span>
      </div>
      <div class="batch-actions" aria-label="Batch status actions">
        <span>Update shown rows:</span>
        <button type="button" data-bulk-status="To Prepare">To Prepare</button>
        <button type="button" data-bulk-status="Printing">Printing</button>
        <button type="button" data-bulk-status="Assembling">Assembling</button>
        <button type="button" data-bulk-status="Ready to Mail">Ready to Mail</button>
        <button type="button" data-bulk-status="Mailed">Mailed</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Status</th>
              <th>Recipient</th>
              <th>Character</th>
              <th>Plan</th>
              <th>Letter</th>
              <th>Mailing ID</th>
              <th>Billing Order</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>${rows.map(queueRow).join('')}</tbody>
        </table>
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-status-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const row = rows.find((mailing) => mailingKey(mailing) === select.getAttribute('data-status-select'));
      if (row) {
        updateMailingStatus(row, select.value);
        render();
      }
    });
  });

  viewMount.querySelectorAll('[data-bulk-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextStatus = button.getAttribute('data-bulk-status');
      rows.forEach((mailing) => updateMailingStatus(mailing, nextStatus));
      render();
    });
  });
}

function queueRow(mailing) {
  const flags = [
    mailing.overdue ? '<span class="flag flag-rose">Overdue</span>' : '',
    mailing.dueNext14Days ? '<span class="flag flag-amber">Next batch</span>' : '',
    !mailing.shipDate ? '<span class="flag flag-rose">No date</span>' : '',
  ].join('');

  return `
    <tr>
      <td>${formatDate(mailing.shipDate)}</td>
      <td>
        <select class="status-select status-${statusClass(mailing.status)}" data-status-select="${escapeHtml(mailingKey(mailing))}">
          ${statusOrder.map((status) => `<option ${status === mailing.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
        </select>
      </td>
      <td><strong>${escapeHtml(mailing.recipientName)}</strong><span>${escapeHtml(mailing.email || 'Missing email')}</span></td>
      <td>${escapeHtml(mailing.character)}</td>
      <td>${escapeHtml(mailing.plan)}</td>
      <td>${escapeHtml(mailing.letterNumber)}</td>
      <td class="mono">${escapeHtml(mailing.mailingId)}</td>
      <td class="mono">${escapeHtml(mailing.orderId)}</td>
      <td><div class="flag-stack">${flags}</div></td>
    </tr>
  `;
}

function renderExceptions() {
  const rows = activeExceptions()
    .filter((row) => includesText([row.recipientName, row.reason, row.mailingId, row.status, row.severity], state.query))
    .slice(0, 120);

  viewMount.innerHTML = `
    <section class="data-panel" aria-label="Exceptions">
      <div class="panel-head">
        <div>
          <h3>Needs Review</h3>
          <p>Bad data stops here instead of leaking into the mailing schedule.</p>
        </div>
        <span class="panel-count">${rows.length} open</span>
      </div>
      <div class="exception-list">
        ${
          rows.length
            ? rows.map(exceptionRow).join('')
            : '<div class="empty-state">Nothing matches this search. Nicely suspicious.</div>'
        }
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-review]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-review');
      state.reviewed.add(key);
      saveReviewedExceptions();
      saveSharedState('reviewedException', key, '1');
      render();
    });
  });
}

function exceptionRow(item) {
  const suggested = item.suggestedShipDate
    ? `<div class="suggested-date"><span>Suggested ship date</span><strong>${formatDate(item.suggestedShipDate)}</strong></div>`
    : '';
  return `
    <article class="exception-row">
      <div class="severity severity-${escapeHtml(item.severity.toLowerCase())}">${escapeHtml(item.severity)}</div>
      <div>
        <h4>${escapeHtml(item.recipientName)}</h4>
        <p>${escapeHtml(item.reason)}</p>
        ${suggested}
        <div class="row-meta">
          <span>${formatDate(item.shipDate)}</span>
          <span>${escapeHtml(item.status)}</span>
          <span>Sheet row ${escapeHtml(item.sourceRow)}</span>
          <span class="mono">${escapeHtml(item.mailingId)}</span>
        </div>
      </div>
      <button type="button" class="icon-action" data-review="${escapeHtml(exceptionReviewKey(item))}">Reviewed</button>
    </article>
  `;
}

function renderSubscribers() {
  const rows = state.seed.subscribers
    .filter((subscriber) =>
      includesText([subscriber.displayName, subscriber.email, subscriber.subscriberId, subscriber.status, subscriber.openMailings], state.query),
    )
    .slice(0, 80);
  const selected = rows.find((subscriber) => subscriber.subscriberId === state.selectedSubscriberId)
    || rows[0]
    || null;
  if (selected) state.selectedSubscriberId = selected.subscriberId;

  viewMount.innerHTML = `
    <section class="data-panel" aria-label="Subscribers">
      <div class="panel-head">
        <div>
          <h3>Subscribers</h3>
          <p>Stable subscriber records inferred from email and recipient data. Archived subscribers are kept, not deleted.</p>
        </div>
        <span class="panel-count">${rows.length} shown</span>
      </div>
      <div class="subscriber-layout">
        <div class="subscriber-grid">${rows.map((subscriber) => subscriberCard(subscriber, selected?.subscriberId)).join('')}</div>
        ${selected ? subscriberProfile(selected) : '<div class="empty-state">No subscriber selected.</div>'}
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-subscriber-select]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSubscriberId = button.getAttribute('data-subscriber-select');
      renderSubscribers();
    });
  });

  viewMount.querySelectorAll('[data-profile-print-envelope]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = effectiveMailings().find((mailing) => mailingKey(mailing) === button.getAttribute('data-profile-print-envelope'));
      if (row) openEnvelopePrint(envelopePrintRows([row]));
    });
  });

  viewMount.querySelectorAll('[data-profile-mark-envelope]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = effectiveMailings().find((mailing) => mailingKey(mailing) === button.getAttribute('data-profile-mark-envelope'));
      if (row) {
        updateEnvelopeStatus(row, printedEnvelopeStatusForMailing(row));
        renderSubscribers();
      }
    });
  });

  viewMount.querySelectorAll('[data-profile-mark-ashley]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = effectiveMailings().find((mailing) => mailingKey(mailing) === button.getAttribute('data-profile-mark-ashley'));
      if (row) {
        updateEnvelopeStatus(row, 'In Ashley Box');
        updateMailingStatus(row, 'Assembling');
        renderSubscribers();
      }
    });
  });
}

function subscriberCard(subscriber, selectedSubscriberId = '') {
  return `
    <article class="subscriber-card ${subscriber.subscriberId === selectedSubscriberId ? 'subscriber-card-active' : ''}">
      <div class="subscriber-card-head">
        <div>
          <h4>${escapeHtml(subscriber.displayName)}</h4>
          <p>${escapeHtml(subscriber.email || 'Needs email')}</p>
        </div>
        <span class="mono">${escapeHtml(subscriber.subscriberId)}</span>
      </div>
      <dl>
        <div><dt>Status</dt><dd>${escapeHtml(subscriber.status)}</dd></div>
        <div><dt>Open</dt><dd>${number(subscriber.openMailings)}</dd></div>
        <div><dt>Total</dt><dd>${number(subscriber.totalMailings)}</dd></div>
        <div><dt>Issues</dt><dd>${number(subscriber.issueCount)}</dd></div>
        <div><dt>Next ship</dt><dd>${formatDate(subscriber.nextShipDate)}</dd></div>
      </dl>
      <button type="button" class="profile-button" data-subscriber-select="${escapeHtml(subscriber.subscriberId)}"><span class="desktop-label">View Profile</span><span class="mobile-label">View</span></button>
    </article>
  `;
}

function subscriberProfile(subscriber) {
  const rows = effectiveMailings()
    .filter((mailing) => mailing.subscriberId === subscriber.subscriberId)
    .sort((a, b) => (a.shipDate || '9999').localeCompare(b.shipDate || '9999') || numericLetter(a.letterNumber) - numericLetter(b.letterNumber));
  const openRows = rows.filter((mailing) => mailing.status !== 'Mailed' && mailing.activeState === 'Active');
  const recipientIds = new Set(rows.map((mailing) => mailing.recipientId));
  const totalEnvelopeCount = openRows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);

  return `
    <aside class="subscriber-profile" aria-label="Subscriber profile">
      <div class="subscriber-profile-head">
        <div>
          <p class="section-label">Customer Profile</p>
          <h3>${escapeHtml(subscriber.displayName)}</h3>
          <p>${escapeHtml(subscriber.email || 'Needs email')}</p>
        </div>
        <span class="panel-count">${number(openRows.length)} open</span>
      </div>
      <dl class="profile-stats">
        <div><dt>Status</dt><dd>${escapeHtml(subscriber.status)}</dd></div>
        <div><dt>Recipients</dt><dd>${number(recipientIds.size)}</dd></div>
        <div><dt>Total mailings</dt><dd>${number(rows.length)}</dd></div>
        <div><dt>Open envelopes</dt><dd>${number(totalEnvelopeCount)}</dd></div>
      </dl>
      <div class="table-wrap profile-mailings">
        <table>
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Character</th>
              <th>Plan</th>
              <th>Letter</th>
              <th>Status</th>
              <th>Envelope Status</th>
              <th>Envelope</th>
            </tr>
          </thead>
          <tbody>
            ${openRows.length ? openRows.map(profileMailingRow).join('') : '<tr><td colspan="7" class="empty-state">No open mailings for this customer.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="mobile-card-list profile-mobile-cards">
        ${openRows.length ? openRows.map(profileMailingCard).join('') : '<div class="empty-state">No open mailings for this customer.</div>'}
      </div>
    </aside>
  `;
}

function profileMailingRow(mailing) {
  return `
    <tr>
      <td>${formatDate(mailing.shipDate)}</td>
      <td>${escapeHtml(mailing.character)}</td>
      <td>${escapeHtml(mailing.plan)}</td>
      <td>${escapeHtml(mailing.letterNumber)}</td>
      <td><span class="pill status-${statusClass(mailing.status)}">${escapeHtml(mailing.status)}</span></td>
      <td><span class="pill status-${statusClass(componentStatus(mailing, 'envelope'))}">${escapeHtml(componentStatus(mailing, 'envelope'))}</span></td>
      <td>
        <button type="button" class="link-button" data-profile-print-envelope="${escapeHtml(mailingKey(mailing))}">Print Envelope</button>
        <button type="button" class="link-button" data-profile-mark-envelope="${escapeHtml(mailingKey(mailing))}">Mark Printed</button>
        <button type="button" class="link-button" data-profile-mark-ashley="${escapeHtml(mailingKey(mailing))}">Mark At Ashley</button>
        <span>${number(envelopeQuantityForMailing(mailing))} envelope${envelopeQuantityForMailing(mailing) === 1 ? '' : 's'}</span>
      </td>
    </tr>
  `;
}

function profileMailingCard(mailing) {
  return `
    <article class="mobile-action-card">
      <div class="mobile-card-head">
        <div>
          <strong>${formatDate(mailing.shipDate)}</strong>
          <span>${escapeHtml(mailing.character)} Â· Letter ${escapeHtml(mailing.letterNumber)}</span>
        </div>
        <span class="pill status-${statusClass(mailing.status)}">${escapeHtml(mailing.status)}</span>
      </div>
      <dl>
        <div><dt>Plan</dt><dd>${escapeHtml(mailing.plan)}</dd></div>
        <div><dt>Envelope</dt><dd>${escapeHtml(componentStatus(mailing, 'envelope'))}</dd></div>
        <div><dt>Qty</dt><dd>${number(envelopeQuantityForMailing(mailing))}</dd></div>
      </dl>
      <div class="mobile-card-actions">
        <button type="button" class="link-button" data-profile-print-envelope="${escapeHtml(mailingKey(mailing))}">Print Envelope</button>
        <button type="button" class="link-button" data-profile-mark-envelope="${escapeHtml(mailingKey(mailing))}">Mark Printed</button>
        <button type="button" class="link-button" data-profile-mark-ashley="${escapeHtml(mailingKey(mailing))}">At Ashley</button>
      </div>
    </article>
  `;
}

function batchDatesForOrder(orderDate, count) {
  const dates = [];
  const start = new Date(`${orderDate}T00:00:00`);
  const cursor = new Date(start);
  cursor.setDate(1);

  while (dates.length < count) {
    for (const day of [1, 15]) {
      const batch = new Date(cursor);
      batch.setDate(day);
      const diffDays = Math.ceil((batch - start) / 86400000);
      if (diffDays >= 3) {
        dates.push(new Date(batch.getTime() - batch.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
        if (dates.length === count) break;
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return dates;
}

function plannedLetterCount(plan) {
  if (plan === 'Month-to-month') return 2;
  if (plan === '6-month') return 12;
  if (plan === '12-month') return 24;
  return 1;
}

function numericLetter(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function findSubscriptionMailings(subscriptionId) {
  return state.seed.mailings.filter((mailing) => (
    mailing.subscriptionId === subscriptionId
  ));
}

function getSubscriberSubscriptions(subscriberId) {
  return state.seed.subscriptions
    .filter((subscription) => subscription.subscriberId === subscriberId)
    .sort((a, b) => `${a.character}-${a.plan}`.localeCompare(`${b.character}-${b.plan}`));
}

function getRecipientName(recipientId) {
  const recipient = state.seed.recipients.find((item) => item.recipientId === recipientId);
  return recipient?.name || 'Unknown recipient';
}

function getRecipient(recipientId) {
  return state.seed.recipients.find((item) => item.recipientId === recipientId) || null;
}

function printModeForPlan(plan) {
  if (plan === 'Month-to-month') return 'Month-to-month';
  if (plan === '6-month' || plan === '12-month') return 'Prepaid bulk';
  return 'Special';
}

function envelopeStockForCharacter(character) {
  const key = driveCharacterKey(character);
  const kidCharacters = new Set(['harper', 'marley', 'oliver', 'ringo']);
  if (kidCharacters.has(key)) return `${titleCase(key)} color envelope`;
  return 'Adult standard envelope';
}

function titleCase(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function storageBinForMailing(mailing) {
  if (!mailing.shipDate) return 'Needs date';
  return `Ashley / ${formatDate(mailing.shipDate)} bin`;
}

function driveCharacterKey(character) {
  return String(character || '')
    .trim()
    .replace(/^(new|old)\s+/i, '')
    .toLowerCase();
}

function letterNumberKey(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

function characterFolderUrl(mailing) {
  return driveConfig.characterFolders[driveCharacterKey(mailing.character)] || '';
}

function envelopeFolderUrl(mailing) {
  return driveConfig.envelopeFolders[driveCharacterKey(mailing.character)] || '';
}

function letterFolderUrl(mailing) {
  const characterKey = driveCharacterKey(mailing.character);
  const letterKey = letterNumberKey(mailing.letterNumber);
  return driveConfig.letterFolders[characterKey]?.[letterKey] || '';
}

function driveButton(label, url, fallbackAction) {
  if (url) {
    return `<button type="button" class="link-button" data-drive-url="${escapeHtml(url)}">${escapeHtml(label)}</button>`;
  }
  return `<button type="button" class="link-button" data-print-action="${escapeHtml(fallbackAction)}">${escapeHtml(label)}</button>`;
}

function addressLines(mailing) {
  const recipient = getRecipient(mailing.recipientId);
  const address = recipient?.address || '';
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return [parts[0], `${parts[1]}, ${parts.slice(2).join(', ')}`];
  }
  return address ? [address] : ['Missing address'];
}

function envelopeProfileForCharacter(character) {
  const key = driveCharacterKey(character);
  const adultProfile = [
    '"Allura", "Segoe Script", "Brush Script MT", cursive',
    '"EB Garamond", serif',
    '24pt',
    '13.5pt',
    '#3B2A1E',
    '1.35',
    '0',
  ];
  const profiles = {
    marley: ['"Quicksand", sans-serif', '"Quicksand", sans-serif', '24pt', '17pt', '#8D164D', '1.35', '0'],
    ringo: ['"Schoolbell", cursive', '"Schoolbell", cursive', '24pt', '17pt', '#E86600', '1.35', '0'],
    oliver: ['"Coming Soon", cursive', '"Coming Soon", cursive', '16pt', '13pt', '#26312d', '1.35', '0'],
    harper: ['"Anonymous Pro", monospace', '"Anonymous Pro", monospace', '15pt', '12.5pt', '#465FD9', '1.32', '0'],
    penelope: adultProfile,
    seraphine: adultProfile,
    marigold: adultProfile,
  };
  const [nameFont, addressFont, nameSize, addressSize, color, lineHeight, letterSpacing] = profiles[key] || adultProfile;
  return { nameFont, addressFont, nameSize, addressSize, color, lineHeight, letterSpacing };
}

function envelopeCornerArtUrl(character) {
  const key = driveCharacterKey(character);
  const artFiles = {
    harper: 'harper-corner.png',
    marley: 'marley-corner.png',
    oliver: 'oliver-corner.png',
    ringo: 'ringo-corner.png',
  };
  if (!artFiles[key]) return '';
  return new URL(`/assets/${artFiles[key]}`, window.location.href).href;
}

function envelopeArtClass(character) {
  const key = driveCharacterKey(character);
  return ['harper', 'marley', 'oliver', 'ringo'].includes(key) ? `art-${key}` : '';
}

function envelopeStyleVars(profile) {
  return [
    `--name-font:${profile.nameFont}`,
    `--address-font:${profile.addressFont}`,
    `--name-size:${profile.nameSize}`,
    `--address-size:${profile.addressSize}`,
    `--envelope-color:${profile.color}`,
    `--line-height:${profile.lineHeight}`,
    `--letter-spacing:${profile.letterSpacing}`,
  ].join(';');
}

function envelopePrintRows(rows) {
  return rows.filter((mailing) => componentStatus(mailing, 'envelope') === 'Need Print').flatMap((mailing) => (
    Array.from({ length: envelopeQuantityForMailing(mailing) }, (_, index) => ({
      ...mailing,
      envelopeCopyNumber: index + 1,
      envelopeCopyTotal: envelopeQuantityForMailing(mailing),
    }))
  ));
}

function envelopePrintCount(rows) {
  return envelopePrintRows(rows).length;
}

function envelopeHtml(rows) {
  const pages = rows.map((mailing) => {
    const lines = addressLines(mailing);
    const profile = envelopeProfileForCharacter(mailing.character);
    const cornerArt = envelopeCornerArtUrl(mailing.character);
    const artClass = envelopeArtClass(mailing.character);
    return `
      <section class="envelope-page" style="${escapeHtml(envelopeStyleVars(profile))}">
        ${cornerArt ? `<img class="corner-art ${escapeHtml(artClass)}" src="${escapeHtml(cornerArt)}" alt="" />` : ''}
        <div class="mail-to">
          <strong>${escapeHtml(mailing.recipientName)}</strong>
          ${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}
        </div>
        <div class="envelope-meta">${escapeHtml(mailing.character)} Â· Envelope ${number(mailing.envelopeCopyNumber || 1)} of ${number(mailing.envelopeCopyTotal || 1)} Â· ${formatDate(mailing.shipDate)}</div>
      </section>
    `;
  }).join('');

  return `<!doctype html>
    <html>
      <head>
        <title>Everletter Envelopes</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Allura&family=Anonymous+Pro&family=Caveat&family=Coming+Soon&family=Dancing+Script&family=EB+Garamond&family=Gloria+Hallelujah&family=Quicksand:wght@400;500;600&family=Schoolbell&display=swap');
          @page { size: 7.25in 5.25in; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #1f2d2a; }
          .envelope-page {
            position: relative;
            width: 7.25in;
            height: 5.25in;
            page-break-after: always;
            background: #fff;
          }
          .return-address {
            position: absolute;
            top: 0.38in;
            left: 0.45in;
            font: 10pt Arial, sans-serif;
            line-height: 1.25;
            color: #4c5654;
          }
          .mail-to {
            position: absolute;
            top: 2.12in;
            left: 1.42in;
            width: 4.55in;
            color: var(--envelope-color);
            text-align: center;
          }
          .mail-to strong,
          .mail-to span {
            display: block;
          }
          .mail-to strong {
            margin-bottom: 0.08in;
            color: var(--envelope-color);
            font-family: var(--name-font);
            font-size: var(--name-size);
            font-weight: 400;
            line-height: var(--line-height);
            letter-spacing: var(--letter-spacing);
          }
          .mail-to span {
            color: var(--envelope-color);
            font-family: var(--address-font);
            font-size: var(--address-size);
            font-weight: 400;
            line-height: var(--line-height);
            letter-spacing: var(--letter-spacing);
          }
          .envelope-meta {
            display: none;
          }
          .corner-art {
            position: absolute;
            left: 0.12in;
            bottom: 0.12in;
            width: 0.86in;
            max-height: 1.28in;
            object-fit: contain;
            object-position: left bottom;
          }
          .corner-art.art-harper {
            left: 0;
            bottom: 0;
            width: 1.8in;
            max-height: 1.45in;
          }
          .corner-art.art-oliver {
            left: 0;
            bottom: 0;
            width: 1.08in;
            max-height: 1.62in;
          }
          .corner-art.art-marley {
            width: 0.95in;
            max-height: 1.34in;
          }
          .corner-art.art-ringo {
            width: 0.88in;
            max-height: 1.28in;
          }
          @media screen {
            body { background: #ecebe6; padding: 24px; }
            .envelope-page { margin: 0 auto 24px; box-shadow: 0 8px 28px rgba(0,0,0,.16); }
          }
        </style>
      </head>
      <body>${pages}</body>
    </html>`;
}

function openEnvelopePrint(rows) {
  const popup = window.open('', '_blank');
  if (!popup) {
    alert('Popup blocked. Allow popups for this file to print envelopes.');
    return;
  }
  popup.document.open();
  popup.document.write(envelopeHtml(rows));
  popup.document.close();
}

function openDriveLink(url) {
  if (!url) {
    alert('Drive link not attached yet. This row needs an envelope or letter file URL.');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function renderImport() {
  const preview = state.importPreview;
  const activeSource = state.importInfo?.sourceName || state.seed?.summary?.sourceFile || 'Built-in starter data';
  const uploadedAt = state.importInfo?.uploadedAt ? formatDate(state.importInfo.uploadedAt.slice(0, 10)) : 'Not uploaded yet';
  viewMount.innerHTML = `
    <section class="data-panel import-panel" aria-label="Import spreadsheet">
      <div class="panel-head">
        <div>
          <h3>Import updated spreadsheet</h3>
          <p>Add new Squarespace orders to your current Everletter Mailing Schedule, then upload the .xlsx here. The CRM will rebuild mailings, exceptions, batches, subscribers, QA, and bins from it.</p>
        </div>
        <span class="panel-count">Launch-week bridge</span>
      </div>

      <div class="import-layout">
        <article class="import-card">
          <span class="sample-badge">Current CRM data</span>
          <dl class="sample-fields">
            <div><dt>Source</dt><dd>${escapeHtml(activeSource)}</dd></div>
            <div><dt>Shared upload</dt><dd>${escapeHtml(uploadedAt)}</dd></div>
            <div><dt>Mailings</dt><dd>${number(state.seed.summary.mailingCount)}</dd></div>
            <div><dt>Needs Review</dt><dd>${number(activeExceptions().length)}</dd></div>
          </dl>
        </article>

        <article class="import-card import-uploader">
          <label class="file-drop">
            <span>Choose Everletter Mailing Schedule</span>
            <strong>.xlsx, .xls, or .csv</strong>
            <input id="spreadsheetUpload" type="file" accept=".xlsx,.xls,.csv" />
          </label>
          <p class="import-hint">Use the same columns you already have: Order ID, Original Order Date, Customer Name and Address, Character, Letter Number, Ship Date, Subscription, Status, Active?, Email.</p>
          ${state.importStatus ? `<div class="import-status">${escapeHtml(state.importStatus)}</div>` : ''}
        </article>
      </div>

      ${preview ? `
        <div class="import-preview">
          <div class="panel-head">
            <div>
              <h3>Preview before publishing</h3>
              <p>${escapeHtml(preview.fileName)} - ${escapeHtml(preview.sheetName)}</p>
            </div>
            <button type="button" id="publishImport" ${state.importBusy ? 'disabled' : ''}>${state.importBusy ? 'Publishing...' : 'Publish to shared CRM'}</button>
          </div>
          <div class="print-summary">
            <div><span>Rows read</span><strong>${number(preview.rowCount)}</strong></div>
            <div><span>Subscribers</span><strong>${number(preview.seed.summary.subscriberCount)}</strong></div>
            <div><span>Mailings</span><strong>${number(preview.seed.summary.mailingCount)}</strong></div>
            <div><span>Open</span><strong>${number(preview.seed.summary.openMailingCount)}</strong></div>
            <div><span>Needs Review</span><strong>${number(preview.seed.summary.exceptionCount)}</strong></div>
          </div>
          <div class="import-checklist">
            <div><strong>After publishing:</strong> Ashley will see this same imported data when she refreshes.</div>
            <div>Existing CRM status clicks are preserved when mailing keys still match the uploaded sheet.</div>
            <div>Bad dates, missing addresses, missing emails, or non-1st/15th mailings appear in Needs Review.</div>
          </div>
        </div>
      ` : ''}
    </section>
  `;

  document.querySelector('#spreadsheetUpload')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.importStatus = 'Reading spreadsheet...';
    state.importPreview = null;
    renderImport();
    try {
      const result = await readWorkbookFile(file);
      state.importPreview = { ...result, fileName: file.name };
      state.importStatus = 'Preview ready. Review the counts, then publish when it looks right.';
    } catch (error) {
      state.importStatus = error instanceof Error ? error.message : 'Could not read that spreadsheet.';
    }
    renderImport();
  });

  document.querySelector('#publishImport')?.addEventListener('click', async () => {
    if (!state.importPreview) return;
    state.importBusy = true;
    state.importStatus = 'Publishing spreadsheet to the shared CRM...';
    renderImport();
    try {
      await saveSharedDataset(state.importPreview.seed, state.importPreview.fileName);
      state.seed = state.importPreview.seed;
      state.importPreview = null;
      state.importBusy = false;
      state.importStatus = 'Imported. This is now the shared CRM data.';
      render();
    } catch (error) {
      state.importBusy = false;
      state.importStatus = error instanceof Error ? error.message : 'Could not publish that spreadsheet.';
      renderImport();
    }
  });
}

function renderPrint() {
  const highExceptionMailingIds = new Set(
    activeExceptions()
      .filter((item) => item.severity === 'High')
      .map((item) => item.mailingId),
  );
  const batchDate = selectedBatchDate();
  const baseRows = effectiveMailings()
    .filter((mailing) => mailing.activeState === 'Active')
    .filter((mailing) => !highExceptionMailingIds.has(mailing.mailingId))
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== 'Mailed')
    .filter((mailing) => componentStatus(mailing, 'envelope') === 'Need Print')
    .filter((mailing) => (state.printScope === 'monthly' ? mailing.plan === 'Month-to-month' : true))
    .filter((mailing) =>
      includesText(
        [mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId],
        state.query,
      ),
    )
    .sort((a, b) => (
      envelopeStockForCharacter(a.character).localeCompare(envelopeStockForCharacter(b.character))
      || driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character))
      || String(a.recipientName).localeCompare(String(b.recipientName))
    ));
  const envelopeGroups = Array.from(baseRows.reduce((groups, mailing) => {
    const key = envelopeStockForCharacter(mailing.character);
    groups.set(key, (groups.get(key) || 0) + envelopeQuantityForMailing(mailing));
    return groups;
  }, new Map()).entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (state.printStockFilter !== 'all' && !envelopeGroups.some(([label]) => label === state.printStockFilter)) {
    state.printStockFilter = 'all';
  }
  const rows = baseRows
    .filter((mailing) => state.printStockFilter === 'all' || envelopeStockForCharacter(mailing.character) === state.printStockFilter)
    .slice(0, 160);
  const monthToMonthCount = rows.filter((mailing) => printModeForPlan(mailing.plan) === 'Month-to-month').length;
  const stockLabel = state.printStockFilter === 'all' ? 'shown' : state.printStockFilter.replace(' envelope', '');
  const latestMonthlyOrderDate = rows
    .filter((mailing) => mailing.plan === 'Month-to-month' && mailing.orderDate)
    .map((mailing) => mailing.orderDate)
    .sort()
    .at(-1);
  const envelopePieceCount = rows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);

  viewMount.innerHTML = `
    <section class="data-panel" aria-label="Batch print">
      <div class="panel-head">
        <div>
          <h3>${batchDate ? `${formatDate(batchDate)} Batch Print` : 'Batch Print'}</h3>
          <p>Shows envelopes still marked Need Print. Once a customer envelope is marked Printed or In Ashley Box, it drops off this print list.</p>
        </div>
        <span class="panel-count">${rows.length} shown / ${number(envelopePieceCount)} envelopes</span>
      </div>

      <div class="print-summary">
        <div><span>Mailing rows</span><strong>${number(rows.length)}</strong></div>
        <div><span>Envelopes to print</span><strong>${number(envelopePieceCount)}</strong></div>
        <div><span>Month-to-month</span><strong>${number(monthToMonthCount)}</strong></div>
        <div><span>Latest renewal</span><strong>${latestMonthlyOrderDate ? formatDate(latestMonthlyOrderDate) : 'None'}</strong></div>
      </div>

      <div class="print-toolbar" aria-label="Print scope">
        <span>Show:</span>
        <button type="button" class="${state.printScope === 'monthly' ? 'active' : ''}" data-print-scope="monthly">Month-to-month only</button>
        <button type="button" class="${state.printScope === 'all' ? 'active' : ''}" data-print-scope="all">All open mailings</button>
      </div>

      <div class="envelope-groups" aria-label="Envelope groups">
        <button type="button" class="${state.printStockFilter === 'all' ? 'active' : ''}" data-print-stock="all">All stocks <strong>${number(baseRows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0))}</strong></button>
        ${envelopeGroups.map(([label, count]) => `<button type="button" class="${state.printStockFilter === label ? 'active' : ''}" data-print-stock="${escapeHtml(label)}">${escapeHtml(label)} <strong>${number(count)}</strong></button>`).join('')}
      </div>

      <div class="batch-actions" aria-label="Print actions">
        <span>Print actions:</span>
        <button type="button" data-browser-print>Print This List</button>
        <button type="button" data-print-envelopes>Print ${escapeHtml(stockLabel)} Envelopes (${number(envelopePieceCount)})</button>
        <button type="button" data-mark-envelopes-printed>Mark ${escapeHtml(stockLabel)} Envelopes Printed</button>
        <button type="button" data-drive-url="${escapeHtml(driveConfig.printReadyFolderUrl)}">Open Print-Ready Folder</button>
        <button type="button" data-print-action="batch-envelope">Open Batch Envelopes</button>
        <button type="button" data-print-action="batch-letter">Open Batch Letters</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Recipient</th>
              <th>Mode</th>
              <th>Renewal Date</th>
              <th>Status</th>
              <th>Envelope Status</th>
              <th>Storage Bin</th>
              <th>Envelope Stock</th>
              <th>Env Qty</th>
              <th>Envelope</th>
              <th>Letter</th>
              <th>Print Notes</th>
            </tr>
          </thead>
          <tbody>${rows.map(printRow).join('')}</tbody>
        </table>
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-print-status]').forEach((select) => {
    select.addEventListener('change', () => {
      const row = rows.find((mailing) => mailingKey(mailing) === select.getAttribute('data-print-status'));
      if (row) {
        updateMailingStatus(row, select.value);
        renderPrint();
      }
    });
  });

  viewMount.querySelectorAll('[data-print-envelope-status]').forEach((select) => {
    select.addEventListener('change', () => {
      const row = rows.find((mailing) => mailingKey(mailing) === select.getAttribute('data-print-envelope-status'));
      if (row) {
        updateEnvelopeStatus(row, select.value);
        renderPrint();
      }
    });
  });

  viewMount.querySelectorAll('[data-print-action]').forEach((button) => {
    button.addEventListener('click', () => {
      alert('Next Drive step: attach the matching envelope or letter file URL for this batch.');
    });
  });

  viewMount.querySelectorAll('[data-drive-url]').forEach((button) => {
    button.addEventListener('click', () => openDriveLink(button.getAttribute('data-drive-url')));
  });

  viewMount.querySelectorAll('[data-print-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      state.printScope = button.getAttribute('data-print-scope');
      state.printStockFilter = 'all';
      renderPrint();
    });
  });

  viewMount.querySelectorAll('[data-print-stock]').forEach((button) => {
    button.addEventListener('click', () => {
      state.printStockFilter = button.getAttribute('data-print-stock');
      renderPrint();
    });
  });

  viewMount.querySelector('[data-browser-print]').addEventListener('click', () => {
    window.print();
  });

  viewMount.querySelector('[data-print-envelopes]').addEventListener('click', () => {
    openEnvelopePrint(envelopePrintRows(rows));
  });

  viewMount.querySelectorAll('[data-print-one-envelope]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = rows.find((mailing) => mailingKey(mailing) === button.getAttribute('data-print-one-envelope'));
      if (row) {
        openEnvelopePrint(envelopePrintRows([row]));
      }
    });
  });

  viewMount.querySelector('[data-mark-envelopes-printed]').addEventListener('click', () => {
    rows.forEach((mailing) => updateEnvelopeStatus(mailing, printedEnvelopeStatusForMailing(mailing)));
    renderPrint();
  });
}

function printRow(mailing) {
  const mode = printModeForPlan(mailing.plan);
  const exactLetterUrl = letterFolderUrl(mailing);
  const fallbackCharacterUrl = characterFolderUrl(mailing);
  const envelopeUrl = envelopeFolderUrl(mailing);
  const letterUrl = exactLetterUrl || fallbackCharacterUrl;
  const envelopeState = envelopeUrl ? 'Character envelope folder' : 'Needs envelope link';
  const letterState = exactLetterUrl ? `Exact Letter ${escapeHtml(mailing.letterNumber)}` : fallbackCharacterUrl ? 'Open character folder' : 'Needs letter link';
  const letterButtonLabel = exactLetterUrl ? 'Open Letter' : fallbackCharacterUrl ? 'Open Character' : 'Needs Link';
  const notes = mode === 'Prepaid bulk'
    ? 'Can be printed/prepared in advance and stored by mail date.'
    : 'Time-sensitive renewal; generate only after paid order sync.';
  return `
    <tr>
      <td>${formatDate(mailing.shipDate)}</td>
      <td><strong>${escapeHtml(mailing.recipientName)}</strong><span>${escapeHtml(mailing.email || 'Missing email')}</span></td>
      <td><span class="flag ${mode === 'Prepaid bulk' ? 'flag-green' : 'flag-amber'}">${escapeHtml(mode)}</span></td>
      <td>${mailing.plan === 'Month-to-month' ? `<strong>${formatDate(mailing.orderDate)}</strong><span>Paid/order date</span>` : `<span>${formatDate(mailing.orderDate)}</span>`}</td>
      <td>
        <select class="status-select status-${statusClass(mailing.status)}" data-print-status="${escapeHtml(mailingKey(mailing))}">
          ${statusOrder.map((status) => `<option ${status === mailing.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="qa-select qa-${statusClass(componentStatus(mailing, 'envelope'))}" data-print-envelope-status="${escapeHtml(mailingKey(mailing))}">
          ${['Need Print', 'Printed', 'Both Printed', 'In Ashley Box', 'Not Needed'].map((option) => `<option ${option === componentStatus(mailing, 'envelope') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
      </td>
      <td>${escapeHtml(storageBinForMailing(mailing))}</td>
      <td>${escapeHtml(envelopeStockForCharacter(mailing.character))}</td>
      <td><strong>${number(envelopeQuantityForMailing(mailing))}</strong><span>${mailing.plan === 'Month-to-month' ? 'This paid month' : 'Per mailing'}</span></td>
      <td>
        <button type="button" class="link-button" data-print-one-envelope="${escapeHtml(mailingKey(mailing))}">Print Envelope</button>
        ${driveButton('Open Folder', envelopeUrl, 'envelope')}
        <span>${escapeHtml(envelopeState)}</span>
      </td>
      <td>${driveButton(letterButtonLabel, letterUrl, 'letter')}<span>${letterState}</span></td>
      <td>${escapeHtml(notes)}</td>
    </tr>
  `;
}

function qaRows() {
  const highExceptionMailingIds = new Set(
    activeExceptions()
      .filter((item) => item.severity === 'High')
      .map((item) => item.mailingId),
  );
  const batchDate = selectedBatchDate();
  return effectiveMailings()
    .filter((mailing) => mailing.activeState === 'Active')
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== 'Mailed')
    .filter((mailing) => (state.printScope === 'monthly' ? mailing.plan === 'Month-to-month' : true))
    .filter((mailing) =>
      includesText(
        [mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId],
        state.query,
      ),
    )
    .sort((a, b) => (
      Number(highExceptionMailingIds.has(b.mailingId)) - Number(highExceptionMailingIds.has(a.mailingId))
      || envelopeStockForCharacter(a.character).localeCompare(envelopeStockForCharacter(b.character))
      || driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character))
      || String(a.recipientName).localeCompare(String(b.recipientName))
    ))
    .slice(0, 180);
}

function exceptionsForMailing(mailing) {
  return activeExceptions().filter((item) => item.mailingId === mailing.mailingId);
}

function defaultComponentStatus(mailing, field) {
  const issues = exceptionsForMailing(mailing);
  const hasHighIssue = issues.some((item) => item.severity === 'High');
  const isPrepaid = printModeForPlan(mailing.plan) === 'Prepaid bulk';

  if (field === 'payment') return hasHighIssue ? 'Needs Check' : 'Active';
  if (field === 'envelope') return isPrepaid ? 'In Ashley Box' : 'Need Print';
  if (field === 'letter') return isPrepaid ? 'Stuffed' : 'Need Print';
  if (field === 'artifact') return 'Need Check';
  if (field === 'insert') return ['marley', 'oliver'].includes(driveCharacterKey(mailing.character)) ? 'Need Check' : 'Not Needed';
  if (field === 'location') return isPrepaid ? 'Ashley' : 'Marcy';
  if (field === 'qa') return hasHighIssue ? 'Problem' : 'Open';
  return '';
}

function componentStatus(mailing, field) {
  return state.componentOverrides[componentKey(mailing, field)] || defaultComponentStatus(mailing, field);
}

function qaIsReady(mailing) {
  return componentStatus(mailing, 'payment') === 'Active'
    && ['Printed', 'Both Printed', 'In Ashley Box', 'Not Needed'].includes(componentStatus(mailing, 'envelope'))
    && ['Stuffed', 'Not Needed'].includes(componentStatus(mailing, 'letter'))
    && ['Packed', 'Not Needed'].includes(componentStatus(mailing, 'artifact'))
    && ['Packed', 'Not Needed'].includes(componentStatus(mailing, 'insert'))
    && componentStatus(mailing, 'qa') === 'Ready';
}

function qaNeedsAttention(mailing) {
  const statuses = qaFields.map((field) => componentStatus(mailing, field.key));
  return statuses.some((status) => ['Need Print', 'Need Check', 'Needs Check', 'CC Failed', 'Paused', 'Problem', 'Open'].includes(status));
}

function renderQa() {
  const batchDate = selectedBatchDate();
  const rows = qaRows();
  const readyCount = rows.filter(qaIsReady).length;
  const problemCount = rows.filter((mailing) => componentStatus(mailing, 'qa') === 'Problem' || componentStatus(mailing, 'payment') !== 'Active').length;
  const envelopePrintCount = rows
    .filter((mailing) => componentStatus(mailing, 'envelope') === 'Need Print')
    .reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);
  const needsCheckCount = rows.filter(qaNeedsAttention).length;

  viewMount.innerHTML = `
    <section class="data-panel" aria-label="Mailing QA">
      <div class="panel-head">
        <div>
          <h3>${batchDate ? `${formatDate(batchDate)} Mailing QA` : 'Mailing QA'}</h3>
          <p>One truth for mailing day: payment, envelope, letter, artifact, insert, physical location, and final ready state.</p>
        </div>
        <span class="panel-count">${rows.length} items</span>
      </div>

      <div class="print-summary qa-summary">
        <div><span>Ready</span><strong>${number(readyCount)}</strong></div>
        <div><span>Envelopes to print</span><strong>${number(envelopePrintCount)}</strong></div>
        <div><span>Needs check</span><strong>${number(needsCheckCount)}</strong></div>
        <div><span>Problems</span><strong>${number(problemCount)}</strong></div>
      </div>

      <div class="print-toolbar" aria-label="QA scope">
        <span>Show:</span>
        <button type="button" class="${state.printScope === 'monthly' ? 'active' : ''}" data-qa-scope="monthly">Month-to-month only</button>
        <button type="button" class="${state.printScope === 'all' ? 'active' : ''}" data-qa-scope="all">All open mailings</button>
      </div>

      <div class="batch-actions" aria-label="QA actions">
        <span>Batch actions:</span>
        <button type="button" data-qa-mark-ready>Mark clean shown rows Ready</button>
        <button type="button" data-qa-mark-mailed>Mark QA-ready rows Mailed</button>
      </div>

      <div class="table-wrap">
        <table class="qa-table">
          <thead>
            <tr>
              <th>Ship Date</th>
              <th>Recipient</th>
              <th>Character</th>
              <th>Plan</th>
              <th>Letter</th>
              <th>Env Qty</th>
              ${qaFields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('')}
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>${rows.length ? rows.map(qaRow).join('') : '<tr><td colspan="14" class="empty-state">Nothing in this QA batch.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-qa-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const [rowKey, field] = select.getAttribute('data-qa-select').split('::field::');
      const row = rows.find((mailing) => mailingKey(mailing) === rowKey);
      if (row) {
        if (field === 'envelope') {
          updateEnvelopeStatus(row, select.value);
        } else {
          updateComponentStatus(row, field, select.value);
        }
        renderQa();
      }
    });
  });

  viewMount.querySelectorAll('[data-qa-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      state.printScope = button.getAttribute('data-qa-scope');
      renderQa();
    });
  });

  viewMount.querySelector('[data-qa-mark-ready]').addEventListener('click', () => {
    rows.filter((mailing) => componentStatus(mailing, 'payment') === 'Active').forEach((mailing) => {
      if (componentStatus(mailing, 'envelope') === 'Need Print') updateEnvelopeStatus(mailing, printedEnvelopeStatusForMailing(mailing));
      if (componentStatus(mailing, 'letter') === 'Need Print') updateComponentStatus(mailing, 'letter', 'Stuffed');
      if (componentStatus(mailing, 'artifact') === 'Need Check') updateComponentStatus(mailing, 'artifact', 'Packed');
      if (componentStatus(mailing, 'insert') === 'Need Check') updateComponentStatus(mailing, 'insert', 'Packed');
      updateComponentStatus(mailing, 'qa', 'Ready');
    });
    renderQa();
  });

  viewMount.querySelector('[data-qa-mark-mailed]').addEventListener('click', () => {
    rows.filter(qaIsReady).forEach((mailing) => updateMailingStatus(mailing, 'Mailed'));
    render();
  });
}

function qaRow(mailing) {
  const issues = exceptionsForMailing(mailing);
  const flags = [
    ...issues.map((item) => `<span class="flag ${item.severity === 'High' ? 'flag-rose' : 'flag-amber'}">${escapeHtml(item.reason)}</span>`),
    !letterFolderUrl(mailing) ? '<span class="flag flag-amber">Letter folder not mapped</span>' : '',
    mailing.plan === 'Month-to-month' ? '<span class="flag flag-blue">Month-to-month</span>' : '<span class="flag flag-green">Prebuilt</span>',
  ].join('');

  return `
    <tr class="${qaIsReady(mailing) ? 'qa-ready-row' : qaNeedsAttention(mailing) ? 'qa-attention-row' : ''}">
      <td>${formatDate(mailing.shipDate)}</td>
      <td><strong>${escapeHtml(mailing.recipientName)}</strong><span>${escapeHtml(mailing.email || 'Missing email')}</span></td>
      <td>${escapeHtml(mailing.character)}<span>${escapeHtml(envelopeStockForCharacter(mailing.character))}</span></td>
      <td>${escapeHtml(mailing.plan)}</td>
      <td>${escapeHtml(mailing.letterNumber)}</td>
      <td><strong>${number(envelopeQuantityForMailing(mailing))}</strong></td>
      ${qaFields.map((field) => qaSelect(mailing, field)).join('')}
      <td><div class="flag-stack">${flags}</div></td>
    </tr>
  `;
}

function qaSelect(mailing, field) {
  const status = componentStatus(mailing, field.key);
  return `
    <td>
      <select class="qa-select qa-${statusClass(status)}" data-qa-select="${escapeHtml(mailingKey(mailing))}::field::${escapeHtml(field.key)}">
        ${field.options.map((option) => `<option ${option === status ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
      </select>
    </td>
  `;
}

function packetRows() {
  const batchDate = selectedBatchDate();
  return effectiveMailings()
    .filter((mailing) => mailing.activeState === 'Active')
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== 'Mailed')
    .filter((mailing) => (state.packetScope === 'monthly' ? mailing.plan === 'Month-to-month' : true))
    .filter((mailing) =>
      includesText(
        [mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId],
        state.query,
      ),
    )
    .sort((a, b) => (
      envelopeStockForCharacter(a.character).localeCompare(envelopeStockForCharacter(b.character))
      || driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character))
      || String(a.recipientName).localeCompare(String(b.recipientName))
    ));
}

function groupedWork(rows, keyFn, countFn = () => 1) {
  const groups = rows.reduce((map, row) => {
    const key = keyFn(row);
    const existing = map.get(key) || { label: key, total: 0, remaining: 0, rows: [] };
    existing.total += countFn(row);
    existing.rows.push(row);
    map.set(key, existing);
    return map;
  }, new Map());
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function packetEnvelopeGroups(rows) {
  return groupedWork(rows, (mailing) => envelopeStockForCharacter(mailing.character), envelopeQuantityForMailing).map((group) => ({
    ...group,
    remaining: group.rows
      .filter((mailing) => componentStatus(mailing, 'envelope') === 'Need Print')
      .reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0),
  }));
}

function packetLetterGroups(rows) {
  return groupedWork(
    rows,
    (mailing) => `${titleCase(driveCharacterKey(mailing.character))} Â· Letter ${mailing.letterNumber}`,
  ).map((group) => ({
    ...group,
    remaining: group.rows.filter((mailing) => componentStatus(mailing, 'letter') === 'Need Print').length,
    missingLinks: group.rows.filter((mailing) => !letterFolderUrl(mailing)).length,
  }));
}

function packetComponentGroups(rows, field) {
  const dueRows = rows.filter((mailing) => componentStatus(mailing, field) !== 'Not Needed');
  return groupedWork(dueRows, (mailing) => titleCase(driveCharacterKey(mailing.character))).map((group) => ({
    ...group,
    remaining: group.rows.filter((mailing) => ['Need Check', 'Need Print', 'Needs Check'].includes(componentStatus(mailing, field))).length,
  }));
}

function packetProblemRows(rows) {
  return rows.filter((mailing) => (
    exceptionsForMailing(mailing).some((item) => item.severity === 'High')
    || componentStatus(mailing, 'payment') !== 'Active'
    || componentStatus(mailing, 'qa') === 'Problem'
    || !mailing.shipDate
  ));
}

function packetChecklist(rows, owner) {
  const envelopeCount = rows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);
  const printableEnvelopeCount = envelopePrintCount(rows);
  const letterCount = rows.length;
  const artifactCount = rows.filter((mailing) => componentStatus(mailing, 'artifact') !== 'Not Needed').length;
  const insertCount = rows.filter((mailing) => componentStatus(mailing, 'insert') !== 'Not Needed').length;
  const problemCount = packetProblemRows(rows).length;

  if (owner === 'Marcy') {
    return [
      `Print ${number(printableEnvelopeCount)} envelopes needed now by stock/color`,
      `Print or pull ${number(letterCount)} letters by character and letter #`,
      `Resolve ${number(problemCount)} do-not-mail rows before anything leaves`,
      'Mark envelope and letter statuses in Mailing QA',
    ];
  }
  return [
    `Pack/check ${number(artifactCount)} artifact rows`,
    `Pack/check ${number(insertCount)} map or insert rows`,
    'Move finished pieces into the correct dated bin',
    'Final scan: every mailed row must be QA Ready',
  ];
}

function renderPacket() {
  const batchDate = selectedBatchDate();
  const rows = packetRows();
  const problemRows = packetProblemRows(rows);
  const envelopeCount = rows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);
  const printableEnvelopeCount = envelopePrintCount(rows);
  const envelopeGroups = packetEnvelopeGroups(rows);
  const letterGroups = packetLetterGroups(rows);
  const artifactGroups = packetComponentGroups(rows, 'artifact');
  const insertGroups = packetComponentGroups(rows, 'insert');

  viewMount.innerHTML = `
    <section class="data-panel packet-panel" aria-label="Batch packet">
      <div class="panel-head">
        <div>
          <h3>${batchDate ? `${formatDate(batchDate)} Batch Packet` : 'Batch Packet'}</h3>
          <p>Printable work order for the whole mailing: what to print, pack, check, hold, and mark ready.</p>
        </div>
        <span class="panel-count">${rows.length} mailings / ${number(envelopeCount)} envelopes</span>
      </div>

      <div class="print-summary packet-summary">
        <div><span>Mailings</span><strong>${number(rows.length)}</strong></div>
        <div><span>Total envelopes</span><strong>${number(envelopeCount)}</strong></div>
        <div><span>Need print now</span><strong>${number(printableEnvelopeCount)}</strong></div>
        <div><span>Do Not Mail</span><strong>${number(problemRows.length)}</strong></div>
      </div>

      <div class="print-toolbar" aria-label="Packet scope">
        <span>Show:</span>
        <button type="button" class="${state.packetScope === 'all' ? 'active' : ''}" data-packet-scope="all">All open mailings</button>
        <button type="button" class="${state.packetScope === 'monthly' ? 'active' : ''}" data-packet-scope="monthly">Month-to-month only</button>
      </div>

      <div class="batch-actions" aria-label="Packet actions">
        <span>Packet actions:</span>
        <button type="button" data-packet-print>Print Packet</button>
        <button type="button" data-packet-envelopes>Print Needed Envelopes (${number(printableEnvelopeCount)})</button>
        <button type="button" data-drive-url="${escapeHtml(driveConfig.printReadyFolderUrl)}">Open Print-Ready Folder</button>
      </div>

      <div class="packet-grid">
        ${packetWorkCard('Envelope Run', 'Print grouped by envelope stock so you only change paper once per group.', envelopeGroups, 'envelopes')}
        ${packetWorkCard('Letter Run', 'Print or pull these letter files before assembly starts.', letterGroups, 'letters')}
        ${packetWorkCard('Artifacts', 'Physical extras that need a pack/check pass.', artifactGroups, 'rows')}
        ${packetWorkCard('Maps / Inserts', 'Character-specific inserts that should be checked before stuffing.', insertGroups, 'rows')}
      </div>

      <div class="packet-grid packet-grid-two">
        ${packetChecklistCard('Marcy Checklist', packetChecklist(rows, 'Marcy'))}
        ${packetChecklistCard('Ashley Checklist', packetChecklist(rows, 'Ashley'))}
      </div>

      <div class="packet-section">
        <div class="panel-head packet-section-head">
          <div>
            <h3>Do Not Mail Yet</h3>
            <p>Rows here need a decision before they go into a bin.</p>
          </div>
          <span class="panel-count">${problemRows.length} held</span>
        </div>
        <div class="table-wrap">
          <table class="packet-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Character</th>
                <th>Plan</th>
                <th>Letter</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>${problemRows.length ? problemRows.map(packetProblemRow).join('') : '<tr><td colspan="5" class="empty-state">No held rows for this packet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="packet-section">
        <div class="panel-head packet-section-head">
          <div>
            <h3>Final Mailing Rows</h3>
            <p>Use this as the physical pack list for the dated bin.</p>
          </div>
          <span class="panel-count">${rows.length} shown</span>
        </div>
        <div class="table-wrap">
          <table class="packet-table packet-final-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Character</th>
                <th>Plan</th>
                <th>Letter</th>
                <th>Env Qty</th>
                <th>Envelope</th>
                <th>Letter</th>
                <th>Artifact</th>
                <th>Insert</th>
                <th>QA</th>
              </tr>
            </thead>
            <tbody>${rows.length ? rows.map(packetFinalRow).join('') : '<tr><td colspan="10" class="empty-state">Nothing in this packet.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="mobile-card-list bins-mobile-cards">
          ${rows.length ? rows.map(binMobileCard).join('') : '<div class="empty-state">No Ashley bin rows for this batch.</div>'}
        </div>
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-packet-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      state.packetScope = button.getAttribute('data-packet-scope');
      renderPacket();
    });
  });

  viewMount.querySelector('[data-packet-print]').addEventListener('click', () => window.print());
  viewMount.querySelector('[data-packet-envelopes]').addEventListener('click', () => openEnvelopePrint(envelopePrintRows(rows)));
  viewMount.querySelectorAll('[data-drive-url]').forEach((button) => {
    button.addEventListener('click', () => openDriveLink(button.getAttribute('data-drive-url')));
  });
}

function packetWorkCard(title, copy, groups, unit) {
  return `
    <article class="packet-card">
      <div>
        <h4>${escapeHtml(title)}</h4>
        <p>${escapeHtml(copy)}</p>
      </div>
      <div class="packet-list">
        ${groups.length ? groups.map((group) => `
          <div>
            <strong>${escapeHtml(group.label)}</strong>
            <span>${number(group.total)} ${escapeHtml(unit)}${group.remaining ? ` Â· ${number(group.remaining)} open` : ''}${group.missingLinks ? ` Â· ${number(group.missingLinks)} missing links` : ''}</span>
          </div>
        `).join('') : '<div><strong>None</strong><span>No rows for this packet.</span></div>'}
      </div>
    </article>
  `;
}

function packetChecklistCard(title, items) {
  return `
    <article class="packet-card packet-checklist-card">
      <h4>${escapeHtml(title)}</h4>
      <ul class="packet-checklist">
        ${items.map((item) => `<li><span></span>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </article>
  `;
}

function packetProblemRow(mailing) {
  const reasons = [
    ...exceptionsForMailing(mailing).map((item) => item.reason),
    componentStatus(mailing, 'payment') !== 'Active' ? `Payment: ${componentStatus(mailing, 'payment')}` : '',
    componentStatus(mailing, 'qa') === 'Problem' ? 'QA marked Problem' : '',
    !mailing.shipDate ? 'Missing ship date' : '',
  ].filter(Boolean);
  return `
    <tr>
      <td><strong>${escapeHtml(mailing.recipientName)}</strong><span>${escapeHtml(mailing.email || 'Missing email')}</span></td>
      <td>${escapeHtml(mailing.character)}</td>
      <td>${escapeHtml(mailing.plan)}</td>
      <td>${escapeHtml(mailing.letterNumber)}</td>
      <td><div class="flag-stack">${reasons.map((reason) => `<span class="flag flag-rose">${escapeHtml(reason)}</span>`).join('')}</div></td>
    </tr>
  `;
}

function packetFinalRow(mailing) {
  return `
    <tr class="${qaIsReady(mailing) ? 'qa-ready-row' : qaNeedsAttention(mailing) ? 'qa-attention-row' : ''}">
      <td><strong>${escapeHtml(mailing.recipientName)}</strong><span>${escapeHtml(mailing.email || 'Missing email')}</span></td>
      <td>${escapeHtml(mailing.character)}</td>
      <td>${escapeHtml(mailing.plan)}</td>
      <td>${escapeHtml(mailing.letterNumber)}</td>
      <td><strong>${number(envelopeQuantityForMailing(mailing))}</strong></td>
      <td><span class="pill status-${statusClass(componentStatus(mailing, 'envelope'))}">${escapeHtml(componentStatus(mailing, 'envelope'))}</span></td>
      <td><span class="pill status-${statusClass(componentStatus(mailing, 'letter'))}">${escapeHtml(componentStatus(mailing, 'letter'))}</span></td>
      <td><span class="pill status-${statusClass(componentStatus(mailing, 'artifact'))}">${escapeHtml(componentStatus(mailing, 'artifact'))}</span></td>
      <td><span class="pill status-${statusClass(componentStatus(mailing, 'insert'))}">${escapeHtml(componentStatus(mailing, 'insert'))}</span></td>
      <td><span class="pill status-${statusClass(componentStatus(mailing, 'qa'))}">${escapeHtml(componentStatus(mailing, 'qa'))}</span></td>
    </tr>
  `;
}

function binRows() {
  const batchDate = selectedBatchDate();
  return effectiveMailings()
    .filter((mailing) => mailing.activeState === 'Active')
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== 'Mailed')
    .filter((mailing) => printModeForPlan(mailing.plan) === 'Prepaid bulk')
    .filter((mailing) =>
      includesText(
        [mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId],
        state.query,
      ),
    )
    .sort((a, b) => (
      driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character))
      || numericLetter(a.letterNumber) - numericLetter(b.letterNumber)
      || String(a.recipientName).localeCompare(String(b.recipientName))
    ));
}

function binGroups(rows) {
  return groupedWork(
    rows,
    (mailing) => `${formatDate(mailing.shipDate)} Â· ${titleCase(driveCharacterKey(mailing.character))} Â· Letter ${mailing.letterNumber}`,
  ).map((group) => ({
    ...group,
    ready: group.rows.filter((mailing) => binStatus(mailing).label === 'Ready in Ashley Bin').length,
    needsCheck: group.rows.filter((mailing) => binStatus(mailing).label !== 'Ready in Ashley Bin').length,
  }));
}

function binStatus(mailing) {
  const missing = [];
  if (componentStatus(mailing, 'envelope') !== 'In Ashley Box') missing.push('Missing Envelope');
  if (componentStatus(mailing, 'letter') !== 'Stuffed') missing.push('Missing Letter');
  if (componentStatus(mailing, 'location') !== 'Ashley') missing.push('Wrong Location');

  if (!missing.length) {
    return { label: 'Ready in Ashley Bin', detail: 'Envelope, letter, and location are confirmed.' };
  }
  if (missing.length === 1) {
    return { label: missing[0], detail: 'Fix this before mailing day.' };
  }
  return { label: 'Needs Bin Check', detail: missing.join(' Â· ') };
}

function renderBins() {
  const batchDate = selectedBatchDate();
  const rows = binRows();
  const groups = binGroups(rows);
  const readyCount = rows.filter((mailing) => binStatus(mailing).label === 'Ready in Ashley Bin').length;
  const needsCheckCount = rows.length - readyCount;
  const missingEnvelopeCount = rows.filter((mailing) => binStatus(mailing).label === 'Missing Envelope').length;
  const missingLetterCount = rows.filter((mailing) => binStatus(mailing).label === 'Missing Letter').length;
  const characterGroups = groupedWork(rows, (mailing) => titleCase(driveCharacterKey(mailing.character)));

  viewMount.innerHTML = `
    <section class="data-panel bins-panel" aria-label="Ashley bins">
      <div class="panel-head">
        <div>
          <h3>${batchDate ? `${formatDate(batchDate)} Ashley Bins` : 'Ashley Bins'}</h3>
          <p>Physical inventory for prepaid 6- and 12-month mailings that should already be stuffed, labeled, and stored by batch date.</p>
        </div>
        <span class="panel-count">${number(rows.length)} bin rows</span>
      </div>

      <div class="print-summary bin-summary">
        <div><span>Prebuilt rows</span><strong>${number(rows.length)}</strong></div>
        <div><span>Ready in bins</span><strong>${number(readyCount)}</strong></div>
        <div><span>Needs bin check</span><strong>${number(needsCheckCount)}</strong></div>
        <div><span>Missing env / letter</span><strong>${number(missingEnvelopeCount)} / ${number(missingLetterCount)}</strong></div>
      </div>

      <div class="batch-actions" aria-label="Bin actions">
        <span>Update shown rows:</span>
        <button type="button" data-bin-mark="ready">Mark In Ashley Box + Stuffed</button>
        <button type="button" data-bin-mark="check">Mark Needs Bin Check</button>
        <button type="button" data-bin-print>Print Bin Checklist</button>
      </div>

      <div class="packet-grid bin-group-grid">
        ${groups.map(binGroupCard).join('') || '<article class="packet-card"><h4>No prepaid rows</h4><p>Nothing is expected in Ashley bins for this batch.</p></article>'}
      </div>

      <div class="packet-section">
        <div class="panel-head packet-section-head">
          <div>
            <h3>Bin Row Checklist</h3>
            <p>Use this to verify each prebuilt piece is physically in the right dated bin.</p>
          </div>
          <span class="panel-count">${number(rows.length)} rows</span>
        </div>
        <div class="table-wrap">
          <table class="packet-table">
            <thead>
              <tr>
                <th>Ship Date</th>
                <th>Recipient</th>
                <th>Character</th>
                <th>Letter</th>
                <th>Bin Status</th>
                <th>Envelope</th>
                <th>Letter Status</th>
                <th>Location</th>
                <th>Bin</th>
              </tr>
            </thead>
            <tbody>${rows.length ? rows.map(binRow).join('') : '<tr><td colspan="9" class="empty-state">No Ashley bin rows for this batch.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-bin-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const [key, field] = select.getAttribute('data-bin-select').split('::field::');
      const row = rows.find((mailing) => mailingKey(mailing) === key);
      if (row) {
        updateComponentStatus(row, field, select.value);
        renderBins();
      }
    });
  });

  viewMount.querySelectorAll('[data-bin-mark]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-bin-mark');
      rows.forEach((mailing) => {
        if (mode === 'ready') {
          updateComponentStatus(mailing, 'envelope', 'In Ashley Box');
          updateComponentStatus(mailing, 'letter', 'Stuffed');
          updateComponentStatus(mailing, 'location', 'Ashley');
        } else {
          updateComponentStatus(mailing, 'envelope', 'Need Print');
          updateComponentStatus(mailing, 'letter', 'Need Print');
          updateComponentStatus(mailing, 'location', 'Marcy');
        }
      });
      renderBins();
    });
  });

  viewMount.querySelector('[data-bin-print]').addEventListener('click', () => window.print());
}

function binGroupCard(group) {
  return `
    <article class="packet-card bin-card">
      <h4>${escapeHtml(group.label)}</h4>
      <p>${number(group.total)} pieces expected in this dated bin group.</p>
      <div class="bin-card-counts">
        <div><span>Confirmed</span><strong>${number(group.ready)}</strong></div>
        <div><span>Check</span><strong>${number(group.needsCheck)}</strong></div>
      </div>
    </article>
  `;
}

function binRow(mailing) {
  const status = binStatus(mailing);
  return `
    <tr>
      <td>${formatDate(mailing.shipDate)}</td>
      <td><strong>${escapeHtml(mailing.recipientName)}</strong><span>${escapeHtml(mailing.plan)}</span></td>
      <td>${escapeHtml(mailing.character)}</td>
      <td>${escapeHtml(mailing.letterNumber)}</td>
      <td><span class="pill status-${statusClass(status.label)}">${escapeHtml(status.label)}</span><span>${escapeHtml(status.detail)}</span></td>
      <td>
        <select class="qa-select qa-${statusClass(componentStatus(mailing, 'envelope'))}" data-bin-select="${escapeHtml(mailingKey(mailing))}::field::envelope">
          ${['Need Print', 'Printed', 'Both Printed', 'In Ashley Box', 'Not Needed'].map((option) => `<option ${option === componentStatus(mailing, 'envelope') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="qa-select qa-${statusClass(componentStatus(mailing, 'letter'))}" data-bin-select="${escapeHtml(mailingKey(mailing))}::field::letter">
          ${['Need Print', 'Printed', 'Stuffed', 'Not Needed'].map((option) => `<option ${option === componentStatus(mailing, 'letter') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="qa-select qa-${statusClass(componentStatus(mailing, 'location'))}" data-bin-select="${escapeHtml(mailingKey(mailing))}::field::location">
          ${['Marcy', 'Ashley', 'Batch Bin', 'Mailed'].map((option) => `<option ${option === componentStatus(mailing, 'location') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
      </td>
      <td>${escapeHtml(storageBinForMailing(mailing))}</td>
    </tr>
  `;
}

function binMobileCard(mailing) {
  const status = binStatus(mailing);
  return `
    <article class="mobile-action-card">
      <div class="mobile-card-head">
        <div>
          <strong>${escapeHtml(mailing.recipientName)}</strong>
          <span>${formatDate(mailing.shipDate)} Â· ${escapeHtml(mailing.character)} Â· Letter ${escapeHtml(mailing.letterNumber)}</span>
        </div>
        <span class="pill status-${statusClass(status.label)}">${escapeHtml(status.label)}</span>
      </div>
      <p>${escapeHtml(status.detail)}</p>
      <dl>
        <div><dt>Plan</dt><dd>${escapeHtml(mailing.plan)}</dd></div>
        <div><dt>Bin</dt><dd>${escapeHtml(storageBinForMailing(mailing))}</dd></div>
      </dl>
      <div class="mobile-select-grid">
        <label>
          <span>Envelope</span>
          <select class="qa-select qa-${statusClass(componentStatus(mailing, 'envelope'))}" data-bin-select="${escapeHtml(mailingKey(mailing))}::field::envelope">
            ${['Need Print', 'Printed', 'Both Printed', 'In Ashley Box', 'Not Needed'].map((option) => `<option ${option === componentStatus(mailing, 'envelope') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Letter</span>
          <select class="qa-select qa-${statusClass(componentStatus(mailing, 'letter'))}" data-bin-select="${escapeHtml(mailingKey(mailing))}::field::letter">
            ${['Need Print', 'Printed', 'Stuffed', 'Not Needed'].map((option) => `<option ${option === componentStatus(mailing, 'letter') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Location</span>
          <select class="qa-select qa-${statusClass(componentStatus(mailing, 'location'))}" data-bin-select="${escapeHtml(mailingKey(mailing))}::field::location">
            ${['Marcy', 'Ashley', 'Batch Bin', 'Mailed'].map((option) => `<option ${option === componentStatus(mailing, 'location') ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
        </label>
      </div>
    </article>
  `;
}

function renderLaunch() {
  const today = todayIso();
  const batchDate = nextBatchDate();
  const rows = packetRows();
  const problemRows = packetProblemRows(rows);
  const monthlyRows = rows.filter((mailing) => mailing.plan === 'Month-to-month');
  const envelopeCount = rows.reduce((sum, mailing) => sum + envelopeQuantityForMailing(mailing), 0);
  const monthlyEnvelopeCount = monthlyRows.reduce((sum, mailing) => sum + envelopeQuantityForMailing(mailing), 0);
  const highExceptions = activeExceptions().filter((item) => item.severity === 'High').length;
  const launchItems = [
    {
      label: 'Use CRM as the mailing source of truth',
      status: 'Ready',
      detail: `Next visible batch is ${formatDate(batchDate)}. Production Queue, Mailing QA, and Batch Packet are all built around that date.`,
    },
    {
      label: 'Run the Batch Packet before assembly',
      status: rows.length ? 'Ready' : 'Check',
      detail: `${number(rows.length)} mailing rows and ${number(envelopeCount)} envelope pieces are in the current packet.`,
    },
    {
      label: 'Print month-to-month envelopes in pairs',
      status: monthlyEnvelopeCount ? 'Ready' : 'Clear',
      detail: `${number(monthlyRows.length)} month-to-month mailing rows need ${number(monthlyEnvelopeCount)} envelopes because each paid month covers two letters.`,
    },
    {
      label: 'Clear held/problem rows before printing',
      status: problemRows.length ? 'Needs Review' : 'Ready',
      detail: problemRows.length ? `${number(problemRows.length)} rows are held in this packet.` : 'No held rows in the active packet.',
    },
    {
      label: 'Give Ashley a shared version before Squarespace sync',
      status: 'Next',
      detail: 'Ashley needs the same live status data before we automate orders. The target is a usable shared link by Jul 22.',
    },
    {
      label: 'Treat Mailchimp sample automation as phase two',
      status: 'Later',
      detail: 'Sample letters are saved and ready. Mailchimp can wait until the mailing process is stable.',
    },
  ];
  const nextWave = [
    ['Shared database', 'Move local browser statuses into a real shared backend so Marcy and Ashley always see the same QA state.'],
    ['Private hosted link', 'Ashley can open the CRM from her computer or phone without using a zip file.'],
    ['Mobile quick actions', 'Make phones useful for lookup, status changes, Ashley bins, and mailing QA without fighting wide tables.'],
    ['Squarespace sync', 'Pull paid orders automatically so order IDs, dates, plans, and customer data are not hand-entered.'],
    ['Mailchimp sample requests', 'Website sample request creates a CRM lead, tags Kid or Adult in Mailchimp, and sends the correct sample letter.'],
    ['Customer profile totals', 'Track lifetime revenue, open mailings, completed letters, samples requested, and conversions in one place.'],
  ];

  viewMount.innerHTML = `
    <section class="launch-layout" aria-label="Launch plan">
      <div class="launch-hero">
        <div>
          <p class="section-label">Launch mode</p>
          <h3>Get the mailing process out of spreadsheets first.</h3>
          <p>The CRM is ready to use as the operational checklist for the next mailing. Mailchimp is important, but it belongs in the automation wave after the core mailing flow stops being painful.</p>
        </div>
        <div class="launch-date-card">
          <span>Today</span>
          <strong>${formatDate(today)}</strong>
          <span>Next batch</span>
          <strong>${formatDate(batchDate)}</strong>
        </div>
      </div>

      <div class="launch-grid">
        <article class="data-panel launch-panel">
          <div class="panel-head">
            <div>
              <h3>Go-live checklist</h3>
              <p>Use this before the next 1st/15th mailing.</p>
            </div>
            <span class="panel-count">${number(highExceptions)} high exceptions</span>
          </div>
          <div class="launch-list">
            ${launchItems.map(launchItem).join('')}
          </div>
        </article>

        <article class="data-panel launch-panel">
          <div class="panel-head">
            <div>
              <h3>Launch order</h3>
              <p>What we should connect after the manual CRM flow is trusted.</p>
            </div>
            <span class="panel-count">Phased</span>
          </div>
          <ol class="launch-roadmap">
            ${nextWave.map(([title, detail], index) => `
              <li>
                <span>${index + 1}</span>
                <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>
              </li>
            `).join('')}
          </ol>
        </article>
      </div>
    </section>
  `;
}

function launchItem(item) {
  return `
    <div class="launch-item">
      <span class="launch-status launch-status-${statusClass(item.status)}">${escapeHtml(item.status)}</span>
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.detail)}</p>
      </div>
    </div>
  `;
}

function renderSamples() {
  const flows = [
    ['Request captured', 'Squarespace form submits email, sample type, source page, and timestamp into the CRM.'],
    ['Lead created', 'CRM creates or updates a Sample Request record and keeps Gmail out of the manual entry loop.'],
    ['Mailchimp tagged', 'CRM adds the email to Mailchimp with sample-kid or sample-adult plus the source.'],
    ['Sample sent', 'Mailchimp Customer Journey sends the correct sample letter automatically.'],
    ['Conversion matched', 'If the same email later buys, CRM links the sample request to the subscriber profile.'],
  ];
  const sampleRows = [
    { type: 'Kid', tag: 'sample-kid', template: 'Kid sample letter', status: state.sampleType === 'Kid' ? 'Selected' : 'Ready' },
    { type: 'Adult', tag: 'sample-adult', template: 'Adult sample letter', status: state.sampleType === 'Adult' ? 'Selected' : 'Ready' },
  ];
  const sampleAssets = [
    {
      title: 'Marley Meadow Charm',
      type: 'Kid',
      file: '/assets/sample-letter-marley.png',
      note: 'Soft, whimsical kid sample with envelope and wax-seal context.',
    },
    {
      title: "Ringo Collector's Path",
      type: 'Kid',
      file: '/assets/sample-letter-ringo.png',
      note: 'Adventure kid sample with map, envelope, seal, and artifact feel.',
    },
    {
      title: 'Penelope Folded Note',
      type: 'Adult',
      file: '/assets/sample-letter-penelope.png',
      note: 'Romantic mystery sample with envelope, paper texture, and wax-seal mood.',
    },
    {
      title: 'Seraphine Loft Letter',
      type: 'Adult',
      file: '/assets/sample-letter-seraphine.png',
      note: 'Soft literary adult sample with handmade paper, seal, and keepsake feel.',
    },
  ];

  viewMount.innerHTML = `
    <section class="data-panel samples-panel" aria-label="Sample requests">
      <div class="panel-head">
        <div>
          <h3>Sample Requests</h3>
          <p>Future intake flow for website sample requests. Mailchimp can send these; the CRM should track them.</p>
        </div>
        <span class="panel-count">Mailchimp setup pending</span>
      </div>
      <div class="samples-layout">
        <div class="sample-card sample-primary">
          <span class="sample-badge">Recommendation</span>
          <h4>Set up Mailchimp, but do not delay CRM launch for it.</h4>
          <p>For today, use the CRM for mailings. Next, we connect the website form to Mailchimp and the CRM so sample requests stop arriving as manual Gmail-only work.</p>
          <div class="sample-toggle" role="group" aria-label="Sample type">
            ${['Kid', 'Adult'].map((type) => `<button type="button" class="${state.sampleType === type ? 'active' : ''}" data-sample-type="${type}">${type}</button>`).join('')}
          </div>
        </div>
        <div class="sample-card">
          <h4>Mailchimp fields to create</h4>
          <dl class="sample-fields">
            <div><dt>Tag</dt><dd>${state.sampleType === 'Kid' ? 'sample-kid' : 'sample-adult'}</dd></div>
            <div><dt>Merge field</dt><dd>SAMPLETYPE</dd></div>
            <div><dt>Journey</dt><dd>Everletter Sample Request</dd></div>
            <div><dt>Status</dt><dd>Requested / Sent / Converted</dd></div>
          </dl>
        </div>
      </div>

      <div class="sample-library">
        <div class="sample-library-head">
          <div>
            <h4>Sample Letter Library</h4>
            <p>These should be saved in Drive and attached or linked from Mailchimp so the sample still feels like real mail.</p>
          </div>
          <span class="sample-badge">${number(sampleAssets.length)} ready</span>
        </div>
        <div class="sample-preview-grid">
          ${sampleAssets.map((asset) => `
            <article class="sample-preview-card">
              <button type="button" data-open-sample="${escapeHtml(asset.file)}" aria-label="Open ${escapeHtml(asset.title)}">
                <img src="${escapeHtml(asset.file)}" alt="${escapeHtml(asset.title)} sample letter preview" />
              </button>
              <div>
                <span class="sample-badge">${escapeHtml(asset.type)}</span>
                <h5>${escapeHtml(asset.title)}</h5>
                <p>${escapeHtml(asset.note)}</p>
              </div>
            </article>
          `).join('')}
        </div>
      </div>

      <div class="sample-flow">
        ${flows.map(([title, detail], index) => `
          <article>
            <span>${index + 1}</span>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(detail)}</p>
          </article>
        `).join('')}
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sample Type</th>
              <th>Mailchimp Tag</th>
              <th>Email Template</th>
              <th>CRM Result</th>
            </tr>
          </thead>
          <tbody>
            ${sampleRows.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.type)}</strong></td>
                <td class="mono">${escapeHtml(row.tag)}</td>
                <td>${escapeHtml(row.template)}</td>
                <td><span class="pill status-${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  viewMount.querySelectorAll('[data-sample-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.sampleType = button.getAttribute('data-sample-type');
      renderSamples();
    });
  });
  viewMount.querySelectorAll('[data-open-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      window.open(button.getAttribute('data-open-sample'), '_blank', 'noopener,noreferrer');
    });
  });
}

function getSyncPreview() {
  const subscriber = state.seed.subscribers.find((item) => item.subscriberId === state.syncSubscriberId) || state.seed.subscribers[0];
  const subscriptions = getSubscriberSubscriptions(subscriber.subscriberId);
  const subscription = subscriptions.find((item) => item.subscriptionId === state.syncSubscriptionId) || subscriptions[0] || state.seed.subscriptions[0];
  const existing = findSubscriptionMailings(subscription.subscriptionId);
  const currentMax = existing.reduce((max, mailing) => Math.max(max, numericLetter(mailing.letterNumber)), 0);
  const count = plannedLetterCount(state.syncPlan);
  const shipDates = batchDatesForOrder(state.syncOrderDate, count);
  const generated = shipDates.map((shipDate, index) => ({
    letterNumber: currentMax + index + 1,
    shipDate,
    mailingId: `SIM-${subscription.subscriptionId}-${shipDate.replaceAll('-', '')}-L${currentMax + index + 1}`,
  }));
  return { subscriber, subscriptions, subscription, existing, currentMax, count, generated };
}

function renderSync() {
  if (!state.syncSubscriberId) {
    const active = state.seed.subscribers.find((subscriber) => subscriber.status === 'Active') || state.seed.subscribers[0];
    state.syncSubscriberId = active.subscriberId;
    state.syncSubscriptionId = getSubscriberSubscriptions(active.subscriberId)[0]?.subscriptionId || '';
  }

  const preview = getSyncPreview();
  const subscriberOptions = state.seed.subscribers
    .filter((subscriber) => subscriber.status === 'Active')
    .slice(0, 120)
    .map((subscriber) => `<option value="${escapeHtml(subscriber.subscriberId)}" ${subscriber.subscriberId === preview.subscriber.subscriberId ? 'selected' : ''}>${escapeHtml(subscriber.displayName)} Â· ${escapeHtml(subscriber.email || subscriber.subscriberId)}</option>`)
    .join('');
  const subscriptionOptions = preview.subscriptions
    .map((subscription) => {
      const recipientName = getRecipientName(subscription.recipientId);
      const label = `${recipientName} Â· ${subscription.character} Â· ${subscription.plan}`;
      return `<option value="${escapeHtml(subscription.subscriptionId)}" ${subscription.subscriptionId === preview.subscription.subscriptionId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');

  viewMount.innerHTML = `
    <section class="data-panel sync-panel" aria-label="Squarespace sync simulator">
      <div class="panel-head">
        <div>
          <h3>Squarespace Sync Simulator</h3>
          <p>Preview how a daily sync turns a renewal order into the next Everletter mailings.</p>
        </div>
        <span class="panel-count">Daily sync</span>
      </div>
      <div class="sync-layout">
        <div class="sync-form">
          <label>
            <span>Existing subscriber</span>
            <select id="syncSubscriber">${subscriberOptions}</select>
          </label>
          <label>
            <span>Plan / order type</span>
            <select id="syncPlan">
              ${['Month-to-month', '6-month', '12-month', 'One-time'].map((plan) => `<option ${plan === state.syncPlan ? 'selected' : ''}>${plan}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Order paid date</span>
            <input id="syncOrderDate" type="date" value="${escapeHtml(state.syncOrderDate)}" />
          </label>
          <label>
            <span>Subscription sequence</span>
            <select id="syncSubscription">${subscriptionOptions || `<option>${escapeHtml(preview.subscription.subscriptionId)}</option>`}</select>
          </label>
        </div>

        <div class="sync-summary">
          <h4>${escapeHtml(preview.subscriber.displayName)}</h4>
          <p>${escapeHtml(preview.subscriber.email || 'Missing email')} Â· ${escapeHtml(preview.subscriber.subscriberId)}</p>
          <p>${escapeHtml(getRecipientName(preview.subscription.recipientId))} Â· ${escapeHtml(preview.subscription.character)} Â· ${escapeHtml(preview.subscription.plan)}</p>
          <dl>
            <div><dt>Existing letters</dt><dd>${number(preview.existing.length)}</dd></div>
            <div><dt>Highest letter #</dt><dd>${number(preview.currentMax)}</dd></div>
            <div><dt>New letters</dt><dd>${number(preview.count)}</dd></div>
            <div><dt>Order number</dt><dd>New in Squarespace</dd></div>
          </dl>
        </div>
      </div>

      <div class="generated-mailings">
        <h4>Generated mailing rows</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Letter #</th>
                <th>Ship Date</th>
                <th>Status</th>
                <th>Mailing ID</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              ${preview.generated.map((row) => `
                <tr>
                  <td>${row.letterNumber}</td>
                  <td>${formatDate(row.shipDate)}</td>
                  <td><span class="pill status-to-prepare">To Prepare</span></td>
                  <td class="mono">${escapeHtml(row.mailingId)}</td>
                  <td>Next letter after #${number(preview.currentMax)} for this exact recipient + character subscription.</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  document.querySelector('#syncSubscriber').addEventListener('change', (event) => {
    state.syncSubscriberId = event.target.value;
    state.syncSubscriptionId = getSubscriberSubscriptions(state.syncSubscriberId)[0]?.subscriptionId || '';
    renderSync();
  });
  document.querySelector('#syncPlan').addEventListener('change', (event) => {
    state.syncPlan = event.target.value;
    renderSync();
  });
  document.querySelector('#syncOrderDate').addEventListener('change', (event) => {
    state.syncOrderDate = event.target.value;
    renderSync();
  });
  document.querySelector('#syncSubscription').addEventListener('change', (event) => {
    state.syncSubscriptionId = event.target.value;
    renderSync();
  });
}

function renderAutomation() {
  const rules = state.seed.automationRules;
  viewMount.innerHTML = `
    <section class="automation-layout" aria-label="Automation map">
      <div class="automation-column">
        <h3>Live order flow</h3>
        <ol class="flow-list">
          ${flowStep('1', 'Squarespace order arrives', 'Webhook or scheduled API sync captures the raw order exactly once.')}
          ${flowStep('2', 'Match account', 'Use Squarespace customer ID first, email second. One email can own multiple subscriptions.')}
          ${flowStep('3', 'Match subscription sequence', 'Use recipient, address, character, and plan to find the exact subscription under that account.')}
          ${flowStep('4', 'Continue letter sequence', 'Find the highest existing letter number for that exact subscription sequence.')}
          ${flowStep('5', 'Calculate 1st/15th batches', 'Apply the 3-day cutoff and two-letter monthly cadence automatically.')}
          ${flowStep('6', 'Generate mailings', 'Month-to-month creates two monthly mailings. 6-month creates 12. 12-month creates 24.')}
          ${flowStep('7', 'Gate exceptions', 'Missing dates, addresses, characters, emails, or unclear subscription matches stop before production.')}
        </ol>
      </div>
      <div class="automation-column">
        <h3>Rules to lock before connecting Squarespace</h3>
        <div class="rule-stack">
          ${rules.map((rule) => `<article class="rule-item"><strong>${escapeHtml(rule.rule)}</strong><p>${escapeHtml(rule.logic)}</p></article>`).join('')}
        </div>
      </div>
    </section>
  `;
}

function flowStep(icon, title, copy) {
  return `
    <li>
      <span class="step-icon">${icon}</span>
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>
    </li>
  `;
}

function renderView() {
  document.querySelectorAll('.side-nav button').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-view') === state.activeView);
  });
  statusFilterWrap.style.display = state.activeView === 'queue' ? 'flex' : 'none';
  batchFilterWrap.style.display = state.activeView === 'queue' || state.activeView === 'print' || state.activeView === 'qa' || state.activeView === 'packet' || state.activeView === 'bins' ? 'flex' : 'none';
  pastBatchFilterWrap.style.display = batchFilterWrap.style.display;
  if (state.activeView === 'queue') renderQueue();
  if (state.activeView === 'print') renderPrint();
  if (state.activeView === 'qa') renderQa();
  if (state.activeView === 'packet') renderPacket();
  if (state.activeView === 'bins') renderBins();
  if (state.activeView === 'launch') renderLaunch();
  if (state.activeView === 'samples') renderSamples();
  if (state.activeView === 'exceptions') renderExceptions();
  if (state.activeView === 'subscribers') renderSubscribers();
  if (state.activeView === 'import') renderImport();
  if (state.activeView === 'sync') renderSync();
  if (state.activeView === 'automation') renderAutomation();
}

function render() {
  renderShell();
  renderView();
}

async function initializeCrm() {
  if (window.EVERLETTER_SEED) {
    state.seed = window.EVERLETTER_SEED;
    await loadSharedState().catch(() => {});
    render();
  } else {
    viewMount.innerHTML = '<section class="data-panel"><div class="empty-state">Could not load Everletter seed data.</div></section>';
  }
}

// Everything below touches document/window/localStorage, so none of it can
// run at module-evaluation time (a "use client" module is still evaluated
// on the server during SSR, where none of those exist - see app/crm/CrmApp.tsx).
// This is the one function callers invoke, from a browser-only effect, to
// actually start the app; importing this module does nothing observable on
// its own. Guarded so a second call (e.g. React StrictMode's double-invoked
// effect in development) is a safe no-op rather than double-binding every
// listener below and re-running the nav injection.
let initialized = false;
function initCrmApp() {
  if (initialized) return;
  initialized = true;

  const hashView = window.location.hash.slice(1);
  state.activeView = viewNames.has(hashView) ? hashView : 'queue';
  state.reviewed = loadReviewedExceptions();
  state.statusOverrides = loadStatusOverrides();
  state.componentOverrides = loadComponentOverrides();

  topbarMeta = document.querySelector('#topbarMeta');
  metrics = document.querySelector('#metrics');
  statusStrip = document.querySelector('#statusStrip');
  viewMount = document.querySelector('#viewMount');
  searchInput = document.querySelector('#searchInput');
  statusFilter = document.querySelector('#statusFilter');
  statusFilterWrap = document.querySelector('#statusFilterWrap');
  batchFilter = document.querySelector('#batchFilter');
  batchFilterWrap = document.querySelector('#batchFilterWrap');
  pastBatchFilter = document.querySelector('#pastBatchFilter');
  pastBatchFilterWrap = document.querySelector('#pastBatchFilterWrap');

  const printNavButton = document.querySelector('.side-nav [data-view="print"]');
  if (printNavButton && !document.querySelector('.side-nav [data-view="qa"]')) {
    printNavButton.insertAdjacentHTML('afterend', '<button data-view="qa" type="button"><span>QA</span> Mailing QA</button>');
  }
  const qaNavButton = document.querySelector('.side-nav [data-view="qa"]');
  if (qaNavButton && !document.querySelector('.side-nav [data-view="packet"]')) {
    qaNavButton.insertAdjacentHTML('afterend', '<button data-view="packet" type="button"><span>B</span> Batch Packet</button>');
  }
  const packetNavButton = document.querySelector('.side-nav [data-view="packet"]');
  if (packetNavButton && !document.querySelector('.side-nav [data-view="bins"]')) {
    packetNavButton.insertAdjacentHTML('afterend', '<button data-view="bins" type="button"><span>N</span> Ashley Bins</button>');
  }
  const binsNavButton = document.querySelector('.side-nav [data-view="bins"]');
  if (binsNavButton && !document.querySelector('.side-nav [data-view="launch"]')) {
    binsNavButton.insertAdjacentHTML('afterend', '<button data-view="launch" type="button"><span>L</span> Launch Plan</button>');
  }
  const subscriberNavButton = document.querySelector('.side-nav [data-view="subscribers"]');
  if (subscriberNavButton && !document.querySelector('.side-nav [data-view="samples"]')) {
    subscriberNavButton.insertAdjacentHTML('afterend', '<button data-view="samples" type="button"><span>@</span> Sample Requests</button>');
  }

  document.querySelectorAll('.side-nav button').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeView = button.getAttribute('data-view');
      window.location.hash = state.activeView;
      renderView();
    });
  });

  searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderView();
  });

  statusFilter.addEventListener('change', (event) => {
    state.statusFilter = event.target.value;
    renderView();
  });

  batchFilter.addEventListener('change', (event) => {
    state.batchFilter = event.target.value;
    render();
  });

  pastBatchFilter.addEventListener('change', (event) => {
    if (!event.target.value) return;
    state.batchFilter = event.target.value;
    state.statusFilter = 'All';
    render();
  });

  initializeCrm();
}

export {
  state,
  initCrmApp,
  renderView,
  render,
  buildSeedFromSpreadsheet,
  isOpenStatus,
  isOverdueMailing,
  isDueNext14Days,
  nearestBatchDate,
  daysBetween,
  monthKey,
  todayIso,
  mailingKey,
  componentKey,
  exceptionReviewKey,
  buildSubscriberId,
  buildRecipientId,
  buildSubscriptionId,
  buildMailingId,
};
