// Single shared implementation of id/key generation and mailing business
// rules, also used server-side (lib/write-to-tables.ts,
// lib/build-dataset-from-tables.ts) - see each module's own header. Step 3a
// of the app.js decomposition plan (CLAUDE.md); these used to be mirrored,
// hand-synced inline copies, kept honest only by tests that booted the app
// in a sandbox and diffed its output against the lib/ versions. That's gone
// now that this file can import real TypeScript modules (the app.js -> ESM
// move, step 2) - one implementation, imported here instead of duplicated.
import { mailingKey } from '@/lib/domain/keys';
import { isOpenStatus, todayIso } from '@/lib/domain/mailing-rules';
// Step 3b: pure business logic extracted into lib/domain/ (shared with the
// server, same reasoning as the imports above) and app/crm/format.ts
// (display formatting only the browser needs - see that module's header).
// buildSubscriberId/buildRecipientId/buildSubscriptionId/buildMailingId
// (lib/domain/ids), normalizePlan (lib/domain/plans), normalizeCharacter
// (lib/domain/characters), isOverdueMailing/isDueNext14Days/monthKey/
// nearestBatchDate (lib/domain/mailing-rules), and everything from
// lib/domain/spreadsheet/normalize are no longer imported here directly -
// their only call sites were inside buildSeedFromSpreadsheet/
// spreadsheetExceptionReasons, which now live in
// lib/domain/spreadsheet/build-seed.ts and import these themselves.
import { printModeForPlan, envelopeQuantityForMailing } from '@/lib/domain/plans';
import { driveCharacterKey, letterNumberKey, envelopeStockForCharacter } from '@/lib/domain/characters';
import { storageBinForMailing } from '@/lib/domain/batch-dates';
// formatDate/titleCase moved to lib/domain/format.ts (step 3c) once
// storageBinForMailing/envelopeStockForCharacter, which depend on them,
// turned out to be real domain logic rather than display chrome - see
// that module's header. escapeHtml/includesText/statusClass/number stay
// view-only, in app/crm/format.ts.
import { formatDate } from '@/lib/domain/format';
import { escapeHtml, statusClass, number } from './format';
// buildSeedFromSpreadsheet (the 206-line seed builder) and
// spreadsheetExceptionReasons (the exception-reason checks it calls) are
// commit 3's extraction - the highest-risk single move in step 3b, kept
// mechanical: same logic, same order, same output. now/automationRules were
// threaded in explicitly, same reasoning as todayIso(now) - readWorkbookFile,
// this function's one real call site, moved to
// app/crm/views/import/import-selectors.ts in Phase 1 step 11 (CLAUDE.md);
// this import stays only because buildSeedFromSpreadsheet is still a real
// runtime export below, consumed directly by tests.
import { buildSeedFromSpreadsheet } from '@/lib/domain/spreadsheet/build-seed';
// Step 4: the state store, shared-state HTTP client, localStorage override
// caches, and cross-view selectors extracted into lib/client/ - see each
// module's own header and this step's PR description. createCrmState() is a
// factory (not a module-level singleton) specifically so a fresh import of
// this module still produces a fresh, isolated state object every time -
// see lib/client/crm-state.ts's header for why that matters to
// tests/e2e-helpers.mjs's loadAppJsSandbox().
import { loadComponentOverrides, loadReviewedExceptions, loadStatusOverrides } from '@/lib/client/local-overrides';
import { loadSharedState, pollChangeMarker } from '@/lib/client/shared-state-client';
import { createCrmState } from '@/lib/client/crm-state';
import { createSaveFailureStore } from '@/lib/client/save-failures';
import { createStalenessStore } from '@/lib/client/staleness';
import {
  activeExceptions as selectActiveExceptions,
  availableBatchDates as selectAvailableBatchDates,
  componentStatus as selectComponentStatus,
  effectiveMailings as selectEffectiveMailings,
  getRecipient as selectGetRecipient,
  includesText,
  nextBatchDate as selectNextBatchDate,
  pastBatchDates as selectPastBatchDates,
  selectedBatchDate as selectSelectedBatchDate,
} from '@/lib/client/selectors';

// activeView/reviewed/statusOverrides/componentOverrides start as inert
// defaults here (createCrmState() - module evaluation must stay
// side-effect-free, see initCrmApp() at the bottom) and are set to their
// real, DOM/localStorage-derived values by initCrmApp() before anything
// renders. Calling the factory here, at this module's own top level, is
// what keeps state isolated per test sandbox - see the import comment above
// for why.
// createSaveFailureStore() is a factory for the same reason
// createCrmState() is (see the import comment above and
// lib/client/crm-state.ts's own header) - created here, at this
// module's own top level, so a fresh cache-busted import gets a fresh
// store instead of sharing one across "fresh" test sandboxes.
const saveFailures = createSaveFailureStore();
// createStalenessStore() is the same factory-not-singleton story as
// saveFailures above - see lib/client/staleness.ts's own header for the
// mechanism this feeds (the "someone else changed something" banner).
const staleness = createStalenessStore();
const { state, updateMailingStatus, updateComponentStatus, updateEnvelopeStatus, notifyViewChanged, subscribeViewChanged, getRenderGeneration } = createCrmState(saveFailures, staleness);

const statusOrder = ['To Prepare', 'Printing', 'Assembling', 'Ready to Mail', 'Mailed'];
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
let topbarMeta, metrics, statusStrip, viewMount, searchInput, statusFilter, statusFilterWrap, batchFilter, batchFilterWrap, pastBatchFilter, pastBatchFilterWrap, saveFailureBanner, stalenessBanner;

function activeExceptions() {
  return selectActiveExceptions(state.seed, state.reviewed);
}

function effectiveMailings() {
  return selectEffectiveMailings(state.seed, state.statusOverrides);
}

function printedEnvelopeStatusForMailing(mailing) {
  return envelopeQuantityForMailing(mailing) > 1 ? 'Both Printed' : 'Printed';
}

// Adapters, not architecture: these pass app.js's own `state` into the pure
// lib/client/selectors.ts functions so every existing call site below
// (effectiveMailings(), componentStatus(mailing, field), etc.) keeps
// working unchanged. A deliberate exception to step 3b's "no wrapper
// functions" rule (see this step's PR description) - each one disappears
// when its view migrates to React in Phase 1 and calls the pure selector
// directly instead.
function availableBatchDates() {
  return selectAvailableBatchDates(effectiveMailings(), todayIso(new Date()));
}

function pastBatchDates() {
  return selectPastBatchDates(effectiveMailings(), todayIso(new Date()));
}

function nextBatchDate() {
  return selectNextBatchDate(effectiveMailings(), todayIso(new Date()));
}

function selectedBatchDate() {
  return selectSelectedBatchDate(state.batchFilter, effectiveMailings(), todayIso(new Date()));
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

// Renders lib/client/save-failures.ts's current snapshot into
// #saveFailureBanner (app/page.tsx) - deliberately outside #viewMount
// (the render-snapshot harness, tests/render-snapshots.test.mjs, only
// captures #viewMount, so writing here instead is what keeps this
// purely additive feature from touching any of the 17 committed
// snapshots) and independent of renderShell()/renderView() (called
// directly from the saveFailures subscription set up in initCrmApp(),
// below, so a save failure shows up immediately - not just on the next
// full render() - and stays visible no matter which view is active).
//
// Every sentence here has to be true, not just present: a failed save
// leaves the change on this device only, the shared database doesn't
// have it, and reloading the page will lose it - "couldn't save"
// alone doesn't say that. A failed *load* is a different, distinct fact
// (nothing is unsaved - the app just doesn't have the real data) and
// gets its own message rather than folding into the save-failure count.
// Counted, not enumerated: failedSaveCount is a running total across
// possibly many failures (a bulk action can fail dozens of times in one
// click), not a list of each one.
//
// The closing guidance sentence branches on lastFailureCause because "wait
// for connectivity and retry" is only true for a dropped connection - for
// an HTTP rejection (a 409 from the catastrophic-deletion guard, a 400 for
// an invalid status) the user isn't offline and retrying fails again for
// the exact same reason, which the appended server message already names.
// Telling them to wait for connectivity in that case is confidently wrong
// in a way that costs real time.
function renderSaveFailureBanner() {
  const snapshot = saveFailures.getSnapshot();
  const messages = [];

  if (snapshot.failedSaveCount > 0) {
    const n = snapshot.failedSaveCount;
    const changeNoun = n === 1 ? 'change' : 'changes';
    const pronoun = n === 1 ? 'it' : 'them';
    const subject = n === 1 ? 'It' : 'They';
    const verb = n === 1 ? 'exists' : 'exist';
    const guidance =
      snapshot.lastFailureCause === 'http'
        ? `The server refused ${n === 1 ? 'it' : 'the most recent one'} - re-applying ${pronoun} won't help until that's fixed.`
        : `Re-apply ${pronoun} once you're back online.`;
    let text = `${number(n)} ${changeNoun} couldn't be saved. ${subject} only ${verb} on this device - the shared database doesn't have ${pronoun}, and reloading this page will lose ${pronoun}. ${guidance}`;
    if (snapshot.lastFailureMessage) {
      text += ` Most recent error: ${snapshot.lastFailureMessage}`;
    }
    messages.push(text);
  }

  if (snapshot.loadFailed) {
    let text = "Couldn't load the shared data from the server - showing an empty starter dataset instead. Refresh the page to try again.";
    if (snapshot.loadFailureMessage) {
      text += ` Error: ${snapshot.loadFailureMessage}`;
    }
    messages.push(text);
  }

  saveFailureBanner.innerHTML = messages.map((message) => `<p>${escapeHtml(message)}</p>`).join('');
}

// Renders lib/client/staleness.ts's current snapshot into
// #stalenessBanner (app/page.tsx) - same reasoning as
// renderSaveFailureBanner() above (outside #viewMount so the render-
// snapshot harness never sees it, independent of renderShell()/renderView()
// so it shows up immediately and stays visible on any view), but a
// deliberately separate element and function. "Your change didn't save"
// and "someone else changed something" are different problems needing
// different actions - collapsing them into one banner would make both
// harder to act on, and per this task's own design, the two can be true
// and visible at the same time.
//
// Doesn't reference saveFailures' state at all, on purpose: this banner
// only claims what's always true ("refresh to see the latest changes"),
// never the stronger "refreshing loses nothing" - if there's also an
// unsaved failure, that banner is already saying so independently, and
// keeping the two stores decoupled here is what keeps each one's wording
// simple and unconditionally true.
//
// Deliberately says "Mailing data has changed," not "Someone ELSE has
// changed mailing data": the marker this banner reacts to only proves a
// write happened, never who made it. A save whose response is lost after
// the server already committed (network drops between commit and the
// client receiving it) advances the marker without recordOwnMarker() ever
// running - saveSharedState's .catch branch reports that to saveFailures,
// not staleness (see lib/client/shared-state-client.ts), so this banner
// would go stale for the user's OWN change in exactly that case. "Someone
// else" is usually true for a two-person CRM but asserts something the
// mechanism can't actually verify - and the one case it's wrong is the
// same case where the save-failure banner is already telling that same
// user their change didn't save, which "someone else" would flatly
// contradict. The neutral wording stays true either way and points at the
// same remedy (refresh) regardless of whose change it was.
function renderStalenessBanner() {
  const snapshot = staleness.getSnapshot();
  if (!snapshot.stale) {
    stalenessBanner.innerHTML = '';
    return;
  }
  stalenessBanner.innerHTML = '<p>Mailing data has changed since this page loaded. Refresh to see the latest changes. <button type="button" data-refresh-page>Refresh now</button></p>';
  // Refreshing is the entire remedy for this banner - making the button
  // work here, rather than pointing someone at their browser's own
  // refresh control, is the whole point of including it.
  stalenessBanner.querySelector('[data-refresh-page]')?.addEventListener('click', () => {
    window.location?.reload?.();
  });
}

// 45 seconds: frequent enough that a change becomes visible well within
// the minutes it actually takes to walk to the mailing station and act on
// a status (the real mistake this prevents - see this task's own framing),
// infrequent enough that two people leaving the CRM open all day isn't
// meaningfully more server load than one indexed aggregate query every
// 45s each (lib/change-marker.ts) - nowhere close to needing real-time
// sync for a two-person shared tool.
const POLL_INTERVAL_MS = 45000;
let pollTimer = null;

function pollNow() {
  pollChangeMarker(staleness);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollNow, POLL_INTERVAL_MS);
  // Never present in a browser (setInterval returns a plain number there);
  // present in Node, where an un-ref'd timer doesn't keep the process
  // alive by itself - without this, every sandboxed test that calls
  // initCrmApp() (tests/e2e-helpers.mjs's loadAppJsSandbox(), used by
  // dozens of test cases across this suite) would leave a live interval
  // behind with nothing to ever clear it, and `node --test` would hang
  // waiting for the event loop to drain instead of exiting when the
  // actual tests finish.
  pollTimer?.unref?.();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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

function getRecipient(recipientId) {
  return selectGetRecipient(recipientId, state.seed);
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

function componentStatus(mailing, field) {
  return selectComponentStatus(mailing, field, state.seed, state.reviewed, state.componentOverrides);
}

// The view registry: one entry per sidebar view (see
// app/crm/shell/nav-items.ts, the sidebar's own source of truth - kept in
// agreement with this object's keys by tests/nav-items.test.mjs), naming
// its render function and which filter controls it shows. Replaces the
// former renderView() if-chain plus its separate, easy-to-forget
// statusFilterWrap/batchFilterWrap visibility conditionals - adding or
// migrating a view is now a one-place change instead of three.
// pastBatchFilterWrap has no entry of its own: it always follows
// batchFilterWrap's computed display, same coupling as before this step.
//
// `automation` is `react: true` instead of carrying a `render` function -
// the first view migrated to a real React component (app/crm/views/
// Automation.tsx, hosted by app/crm/CrmApp.tsx). Deliberately still a
// full entry here, not removed from the registry: tests/nav-items.test.mjs
// asserts this object's keys match app/crm/shell/nav-items.ts's ids
// exactly, and that invariant (no nav button without a registry entry) is
// exactly what protects the next eleven view migrations from the same
// mistake - only the *shape* of a React-hosted entry changes, not whether
// it exists.
const VIEW_REGISTRY = {
  queue: { react: true, showStatusFilter: true, showBatchFilter: true },
  exceptions: { react: true, showStatusFilter: false, showBatchFilter: false },
  subscribers: { react: true, showStatusFilter: false, showBatchFilter: false },
  samples: { react: true, showStatusFilter: false, showBatchFilter: false },
  import: { react: true, showStatusFilter: false, showBatchFilter: false },
  print: { render: renderPrint, showStatusFilter: false, showBatchFilter: true },
  qa: { react: true, showStatusFilter: false, showBatchFilter: true },
  packet: { react: true, showStatusFilter: false, showBatchFilter: true },
  bins: { react: true, showStatusFilter: false, showBatchFilter: true },
  launch: { react: true, showStatusFilter: false, showBatchFilter: false },
  sync: { react: true, showStatusFilter: false, showBatchFilter: false },
  automation: { react: true, showStatusFilter: false, showBatchFilter: false },
};

function renderView() {
  document.querySelectorAll('.side-nav button').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-view') === state.activeView);
  });
  const entry = VIEW_REGISTRY[state.activeView];
  statusFilterWrap.style.display = entry?.showStatusFilter ? 'flex' : 'none';
  batchFilterWrap.style.display = entry?.showBatchFilter ? 'flex' : 'none';
  pastBatchFilterWrap.style.display = batchFilterWrap.style.display;
  if (entry?.render) {
    entry.render();
  } else {
    // A React-hosted view (or an unrecognized activeView, same as before
    // this change) owns nothing in #viewMount - clear it explicitly
    // rather than leaving whatever the previous legacy view last wrote.
    // Every legacy render() function already replaces viewMount.innerHTML
    // wholesale on its own turn, so this is the one gap that needs
    // covering: switching FROM a legacy view TO a React-hosted one.
    viewMount.innerHTML = '';
  }
  // Tells app/crm/CrmApp.tsx a view switch may have happened, so it can
  // re-render (and, via React's own reconciliation, clear its own mount
  // when leaving automation) - see lib/client/crm-state.ts's own comment
  // on notifyViewChanged() for why this lives here rather than at every
  // individual state.activeView assignment site.
  notifyViewChanged();
}

function render() {
  renderShell();
  renderView();
}

async function initializeCrm() {
  if (window.EVERLETTER_SEED) {
    state.seed = window.EVERLETTER_SEED;
    await loadSharedState(state, saveFailures, staleness).catch(() => {});
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
// listener below.
let initialized = false;
function initCrmApp() {
  if (initialized) return;
  initialized = true;

  const hashView = window.location.hash.slice(1);
  state.activeView = Object.hasOwn(VIEW_REGISTRY, hashView) ? hashView : 'queue';
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
  saveFailureBanner = document.querySelector('#saveFailureBanner');
  stalenessBanner = document.querySelector('#stalenessBanner');

  // Independent of renderShell()/renderView() on purpose (see
  // renderSaveFailureBanner()'s own comment) - a save failure has to show
  // up the moment it's recorded, not wait for the next full render(),
  // and has to stay visible no matter which view is currently active.
  // Rendered once immediately in case state already has something to
  // show (there won't be, this early - state-of-things-so-far), then on
  // every subsequent change.
  renderSaveFailureBanner();
  saveFailures.subscribe(renderSaveFailureBanner);

  // Same immediate-render-then-subscribe shape as above, for the same
  // reason. Polling itself (startPolling(), below) is what actually keeps
  // this banner honest over time - this alone only reacts to markers this
  // client already learned some other way (its own initial load or save).
  renderStalenessBanner();
  staleness.subscribe(renderStalenessBanner);

  // Pause polling when the tab is hidden (no point spending requests on a
  // banner nobody can see) and check immediately on becoming visible again
  // - that's the scenario this feature actually exists for: someone comes
  // back to a tab left open for an hour, which is exactly when acting on
  // stale data becomes a real mailing-day risk. document.addEventListener
  // is optional-chained (rather than assumed) because
  // tests/e2e-helpers.mjs's sandboxed `document` stub - built for
  // document.querySelector() only, long before this feature existed -
  // has no addEventListener of its own; polling still starts in that
  // environment (see startPolling()'s own unref() handling for why a
  // dangling interval there is harmless), it just never pauses.
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopPolling();
    } else {
      pollNow();
      startPolling();
    }
  });
  startPolling();

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
  // Exported only for tests/nav-items.test.mjs, which asserts this
  // object's keys are the exact same set as app/crm/shell/nav-items.ts's
  // ids - not consumed by any runtime caller.
  VIEW_REGISTRY,
  // Exported only for tests/component-fields-parity.test.mjs, which
  // asserts this still matches lib/domain/mailing-rules.ts's
  // MAILING_STATUSES exactly - not consumed by any runtime caller. qaFields
  // was the same story for lib/domain/component-fields.ts's
  // COMPONENT_FIELD_OPTIONS until step 14 (Mailing QA - CLAUDE.md) moved it
  // to app/crm/views/qa/qa-selectors.ts (QA_FIELDS) along with the view
  // that owned it - that test now imports QA_FIELDS directly instead of
  // going through this sandbox export.
  statusOrder,
  // updateMailingStatus/updateEnvelopeStatus were exported only for
  // tests/save-failure-banner.test.mjs (which drives the real save ->
  // lib/client/shared-state-client.ts -> lib/client/save-failures.ts ->
  // renderSaveFailureBanner() pipeline end to end, using
  // updateMailingStatus as a real bulk-action-shaped call site) until
  // step 12 (Subscribers - CLAUDE.md): app/crm/CrmApp.tsx's
  // REACT_VIEWS.subscribers entry now calls both for real, for the
  // profile pane's "Mark Printed"/"Mark At Ashley" actions - the same
  // already-standard write-through mutators every other write path in
  // this file already used, not a new mechanism. updateComponentStatus
  // joins them in step 14 (Mailing QA), for the same reason: seven
  // real, direct per-field writes from a React event handler now, not
  // just through the updateEnvelopeStatus/updateMailingStatus wrappers.
  updateMailingStatus,
  updateComponentStatus,
  updateEnvelopeStatus,
  saveFailures,
  // Exported only for tests/staleness-banner.test.mjs, which drives the
  // real load/save -> lib/client/shared-state-client.ts ->
  // lib/client/staleness.ts -> renderStalenessBanner() pipeline end to
  // end, simulates polling directly (pollNow(), bypassing the real
  // POLL_INTERVAL_MS/45s wait), and inspects/drives the store directly
  // (staleness) - none consumed by any runtime caller beyond what's
  // already wired internally.
  staleness,
  pollNow,
  // notifyViewChanged/subscribeViewChanged/getRenderGeneration are real
  // runtime exports, consumed by app/crm/CrmApp.tsx (the React-hosting
  // seam - see its own header, and lib/client/crm-state.ts's for why
  // getRenderGeneration exists as of step 8) both to observe "a render
  // may be needed" without duplicating any of `state` into React state,
  // and - as of step 8's interactive views - to trigger that same signal
  // from a React event handler after writing into `state` directly,
  // exactly mirroring what a legacy `<select>` onchange handler already
  // does. VIEW_REGISTRY is exported for two runtime callers now, not just
  // tests: CrmApp.tsx reads a view's `react` flag to decide whether to
  // render anything, the same way renderView() above does - both read
  // the one registry rather than each hand-maintaining "which views are
  // React-hosted."
  notifyViewChanged,
  subscribeViewChanged,
  getRenderGeneration,
  // envelopePrintRows/openEnvelopePrint are the envelope print generator
  // (envelopeHtml, the per-character styling, and everything else that
  // path depends on) - explicitly OUT of scope for step 12 (Subscribers)
  // to migrate or rewrite; that's step 17 (Envelope Print), deliberately
  // last since its correctness lands on physical paper. Exported here
  // completely unchanged, purely so app/crm/CrmApp.tsx's
  // REACT_VIEWS.subscribers entry can call them for the profile pane's
  // "Print Envelope" action exactly as the removed legacy handler did
  // (openEnvelopePrint(envelopePrintRows([row]))) - a shared dependency
  // this step calls, not something it owns.
  envelopePrintRows,
  openEnvelopePrint,
  // letterFolderUrl is Drive-config lookup (driveConfig, above - private
  // folder IDs are intentionally never in this repo, so it always resolves
  // to "" here, same as every other Drive lookup) - exported unchanged for
  // step 14 (Mailing QA - CLAUDE.md), whose "Letter folder not mapped" flag
  // is the one piece of renderQa()'s original per-row logic that lives
  // outside lib/client/selectors.ts entirely. A shared dependency
  // app/crm/CrmApp.tsx's REACT_VIEWS.qa entry calls, not something this
  // step owns or rewrites - same category as envelopePrintRows/
  // openEnvelopePrint above.
  letterFolderUrl,
  // driveConfig/openDriveLink are Batch Print/Batch Packet/Ashley Bins'
  // shared Drive plumbing - exported unchanged for step 15 (Batch Packet -
  // CLAUDE.md), whose "Open Print-Ready Folder" button
  // (driveConfig.printReadyFolderUrl) and Drive-URL click handling
  // (openDriveLink - alerts when no URL is configured, same as every
  // other Drive lookup in this sanitized repo) are the one piece of
  // renderPacket()'s original logic that isn't a per-mailing lookup like
  // letterFolderUrl above. A shared dependency app/crm/CrmApp.tsx's
  // REACT_VIEWS.packet entry calls, not something this step owns or
  // rewrites - same category as envelopePrintRows/openEnvelopePrint/
  // letterFolderUrl.
  driveConfig,
  openDriveLink,
};
