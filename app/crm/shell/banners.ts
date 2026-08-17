/**
 * Pure HTML formatting for the save-failure and staleness banners
 * (#saveFailureBanner/#stalenessBanner, app/page.tsx) - given a store
 * snapshot, returns the HTML string a caller assigns to that element's
 * innerHTML. Split out of app/crm/legacy-app.js's renderSaveFailureBanner()/
 * renderStalenessBanner() (Phase 2, the monolith's deletion - CLAUDE.md):
 * those functions mixed the copy/formatting logic with the actual DOM
 * write, so every test proving the wording was correct had to go through a
 * document stub just to read innerHTML back. Neither function actually
 * needs DOM to decide what the banner should say - only app/crm/shell/
 * init-crm-app.ts's one-line callers (which subscribe these to their
 * stores and write the result into the real element) still touch the DOM
 * at all, and that's the one piece tests/staleness-banner.test.mjs's
 * visibility-wiring tests still need a real stub for.
 *
 * Every sentence in formatSaveFailureBannerHtml has to be true, not just
 * present: a failed save leaves the change on this device only, the shared
 * database doesn't have it, and reloading the page will lose it -
 * "couldn't save" alone doesn't say that. A failed *load* is a different,
 * distinct fact (nothing is unsaved - the app just doesn't have the real
 * data) and gets its own message rather than folding into the save-failure
 * count. Counted, not enumerated: failedSaveCount is a running total across
 * possibly many failures (a bulk action can fail dozens of times in one
 * click), not a list of each one.
 *
 * The closing guidance sentence branches on lastFailureCause because "wait
 * for connectivity and retry" is only true for a dropped connection - for
 * an HTTP rejection (a 409 from the catastrophic-deletion guard, a 400 for
 * an invalid status) the user isn't offline and retrying fails again for
 * the exact same reason, which the appended server message already names.
 * Telling them to wait for connectivity in that case is confidently wrong
 * in a way that costs real time.
 */

import { escapeHtml, number } from "../format";
import type { SaveFailureSnapshot } from "@/lib/client/save-failures";
import type { StalenessSnapshot } from "@/lib/client/staleness";

export function formatSaveFailureBannerHtml(snapshot: SaveFailureSnapshot): string {
  const messages: string[] = [];

  if (snapshot.failedSaveCount > 0) {
    const n = snapshot.failedSaveCount;
    const changeNoun = n === 1 ? "change" : "changes";
    const pronoun = n === 1 ? "it" : "them";
    const subject = n === 1 ? "It" : "They";
    const verb = n === 1 ? "exists" : "exist";
    const guidance =
      snapshot.lastFailureCause === "http"
        ? `The server refused ${n === 1 ? "it" : "the most recent one"} - re-applying ${pronoun} won't help until that's fixed.`
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

  return messages.map((message) => `<p>${escapeHtml(message)}</p>`).join("");
}

// Doesn't reference the save-failure snapshot at all, on purpose: this
// banner only claims what's always true ("refresh to see the latest
// changes"), never the stronger "refreshing loses nothing" - if there's
// also an unsaved failure, that banner is already saying so independently,
// and keeping the two decoupled here is what keeps each one's wording
// simple and unconditionally true.
//
// Deliberately says "Mailing data has changed," not "Someone ELSE has
// changed mailing data": the marker this banner reacts to only proves a
// write happened, never who made it - see
// app/crm/shell/init-crm-app.ts's own header for the full reasoning this
// wording preserves unchanged from app/crm/legacy-app.js.
export function formatStalenessBannerHtml(snapshot: StalenessSnapshot): string {
  if (!snapshot.stale) return "";
  return '<p>Mailing data has changed since this page loaded. Refresh to see the latest changes. <button type="button" data-refresh-page>Refresh now</button></p>';
}
