/**
 * Google Drive link plumbing shared by Mailing QA, Batch Packet, Ashley
 * Bins, and Batch Print: the (always-empty in this sanitized repo - see
 * CLAUDE.md's data-boundary note, no real Drive folder IDs are ever
 * committed) folder configuration, a per-mailing exact-letter lookup, and
 * the click handler every Drive-link button shares. Moved from
 * app/crm/legacy-app.js (Phase 2, the monolith's deletion - CLAUDE.md) as
 * its own module rather than folded into the app-state bootstrap - this is
 * link plumbing, not shared application state, and burying it in a module
 * named for state would make it hard to find later. Lives here rather than
 * lib/client/ because openDriveLink() calls window.open()/alert() directly,
 * which would violate lib/client/'s own "no DOM dependency" invariant (see
 * that directory's module headers) - app/crm/views/envelope-print/
 * envelope-html.ts made the same call for the same reason.
 *
 * The DriveConfig interface here is the same shape
 * app/crm/views/envelope-print/print-selectors.ts declared independently
 * before this move - that file now imports this one instead of keeping its
 * own copy, closing a real, exact duplication.
 */

import { driveCharacterKey, letterNumberKey } from "@/lib/domain/characters";

export interface DriveConfig {
  printReadyFolderUrl: string;
  characterFolders: Record<string, string>;
  envelopeFolders: Record<string, string>;
  letterFolders: Record<string, Record<string, string>>;
}

export const driveConfig: DriveConfig = {
  printReadyFolderUrl: "",
  characterFolders: {
    harper: "",
    legends: "",
    marigold: "",
    marley: "",
    "mothers day": "",
    oliver: "",
    penelope: "",
    ringo: "",
    seraphine: "",
  },
  envelopeFolders: {
    harper: "",
    legends: "",
    marigold: "",
    marley: "",
    oliver: "",
    penelope: "",
    ringo: "",
    seraphine: "",
  },
  letterFolders: {
    legends: {
      3: "",
    },
    marigold: {
      1: "",
      4: "",
      10: "",
    },
    penelope: {
      6: "",
      7: "",
      8: "",
      10: "",
    },
  },
};

export function letterFolderUrl(mailing: { character: string; letterNumber: string | number }): string {
  const characterKey = driveCharacterKey(mailing.character);
  const letterKey = letterNumberKey(mailing.letterNumber);
  return driveConfig.letterFolders[characterKey]?.[letterKey] || "";
}

export function openDriveLink(url: string): void {
  if (!url) {
    alert("Drive link not attached yet. This row needs an envelope or letter file URL.");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
