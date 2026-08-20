/**
 * The envelope print-window generator, relocated unchanged from
 * app/crm/legacy-app.js's envelopeHtml()/envelopePrintRows()/
 * openEnvelopePrint()/envelopeProfileForCharacter()/envelopeCornerArtUrl()/
 * envelopeArtClass()/envelopeStyleVars() (Phase 1 step 17 - CLAUDE.md, the
 * last of twelve views, and the only one whose output lands on physical
 * paper).
 *
 * This does NOT become React. It builds a complete standalone HTML
 * document as a string, opens a new window, and writes it there - React
 * has nothing to offer that, and rewriting the string-building logic
 * risks physical output no automated test can check (wrong margins,
 * wrong feed orientation, wrong font on the wrong colored stock). A pure
 * relocation: same @import for Google Fonts, same per-character styling,
 * same markup, proven byte-identical against
 * tests/fixtures/envelope-html-golden.html (captured against this exact
 * logic before it moved - see that commit) in
 * tests/envelope-html-golden.test.mjs.
 *
 * The one real change this relocation forces, not a behavior change:
 * every function here used to close over app/crm/legacy-app.js's `state`
 * global (via componentStatus()/getRecipient() adapters). Outside that
 * closure, seed/reviewed/componentOverrides are threaded in explicitly -
 * the same transformation every other selector promoted out of
 * legacy-app.js in this migration has already gone through (qaIsReady,
 * binStatus, groupedWork's siblings). The OUTPUT is unchanged for the
 * same effective inputs; only how those inputs arrive changed.
 */

import type { Dataset } from "@/lib/domain/dataset";
import { componentStatus, getRecipient, type EffectiveMailing } from "@/lib/client/selectors";
import { driveCharacterKey } from "@/lib/domain/characters";
import { envelopeQuantityForMailing } from "@/lib/domain/plans";
import { formatDate } from "@/lib/domain/format";
import { escapeHtml, number } from "../../format";

function addressLines(mailing: EffectiveMailing, seed: Dataset): string[] {
  const recipient = getRecipient(mailing.recipientId, seed);
  const address = recipient?.address || "";
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return [parts[0], `${parts[1]}, ${parts.slice(2).join(", ")}`];
  }
  return address ? [address] : ["Missing address"];
}

export interface EnvelopeProfile {
  nameFont: string;
  addressFont: string;
  nameSize: string;
  addressSize: string;
  color: string;
  lineHeight: string;
  letterSpacing: string;
}

export function envelopeProfileForCharacter(character: string): EnvelopeProfile {
  const key = driveCharacterKey(character);
  const adultProfile = ['"Allura", "Segoe Script", "Brush Script MT", cursive', '"EB Garamond", serif', "24pt", "13.5pt", "#3B2A1E", "1.35", "0"];
  const profiles: Record<string, string[]> = {
    marley: ['"Quicksand", sans-serif', '"Quicksand", sans-serif', "24pt", "17pt", "#8D164D", "1.35", "0"],
    ringo: ['"Schoolbell", cursive', '"Schoolbell", cursive', "24pt", "17pt", "#E86600", "1.35", "0"],
    oliver: ['"Coming Soon", cursive', '"Coming Soon", cursive', "16pt", "13pt", "#26312d", "1.35", "0"],
    harper: ['"Anonymous Pro", monospace', '"Anonymous Pro", monospace', "15pt", "12.5pt", "#465FD9", "1.32", "0"],
    penelope: adultProfile,
    seraphine: adultProfile,
    marigold: adultProfile,
  };
  const [nameFont, addressFont, nameSize, addressSize, color, lineHeight, letterSpacing] = profiles[key] || adultProfile;
  return { nameFont, addressFont, nameSize, addressSize, color, lineHeight, letterSpacing };
}

export function envelopeCornerArtUrl(character: string): string {
  const key = driveCharacterKey(character);
  const artFiles: Record<string, string> = {
    harper: "harper-corner.png",
    marley: "marley-corner.png",
    oliver: "oliver-corner.png",
    ringo: "ringo-corner.png",
  };
  if (!artFiles[key]) return "";
  return new URL(`/assets/${artFiles[key]}`, window.location.href).href;
}

export function envelopeArtClass(character: string): string {
  const key = driveCharacterKey(character);
  return ["harper", "marley", "oliver", "ringo"].includes(key) ? `art-${key}` : "";
}

export function envelopeStyleVars(profile: EnvelopeProfile): string {
  return [
    `--name-font:${profile.nameFont}`,
    `--address-font:${profile.addressFont}`,
    `--name-size:${profile.nameSize}`,
    `--address-size:${profile.addressSize}`,
    `--envelope-color:${profile.color}`,
    `--line-height:${profile.lineHeight}`,
    `--letter-spacing:${profile.letterSpacing}`,
  ].join(";");
}

export interface EnvelopePrintMailing extends EffectiveMailing {
  envelopeCopyNumber: number;
  envelopeCopyTotal: number;
}

export function allEnvelopePrintRows(rows: EffectiveMailing[]): EnvelopePrintMailing[] {
  return rows.flatMap((mailing) =>
    Array.from({ length: envelopeQuantityForMailing(mailing) }, (_, index) => ({
      ...mailing,
      envelopeCopyNumber: index + 1,
      envelopeCopyTotal: envelopeQuantityForMailing(mailing),
    })),
  );
}

export function envelopePrintRows(rows: EffectiveMailing[], seed: Dataset, reviewed: Set<string>, componentOverrides: Record<string, string>): EnvelopePrintMailing[] {
  return rows
    .filter((mailing) => componentStatus(mailing, "envelope", seed, reviewed, componentOverrides) === "Need Print")
    .flatMap((mailing) => allEnvelopePrintRows([mailing]));
}

export function envelopeHtml(rows: EnvelopePrintMailing[], seed: Dataset): string {
  const pages = rows
    .map((mailing) => {
      const lines = addressLines(mailing, seed);
      const profile = envelopeProfileForCharacter(mailing.character);
      const cornerArt = envelopeCornerArtUrl(mailing.character);
      const artClass = envelopeArtClass(mailing.character);
      return `
      <section class="envelope-page" style="${escapeHtml(envelopeStyleVars(profile))}">
        ${cornerArt ? `<img class="corner-art ${escapeHtml(artClass)}" src="${escapeHtml(cornerArt)}" alt="" />` : ""}
        <div class="mail-to">
          <strong>${escapeHtml(mailing.recipientName)}</strong>
          ${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
        </div>
        <div class="envelope-meta">${escapeHtml(mailing.character)} Â· Envelope ${number(mailing.envelopeCopyNumber || 1)} of ${number(mailing.envelopeCopyTotal || 1)} Â· ${formatDate(mailing.shipDate)}</div>
      </section>
    `;
    })
    .join("");

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

export function openEnvelopePrint(rows: EnvelopePrintMailing[], seed: Dataset): void {
  const popup = window.open("", "_blank");
  if (!popup) {
    alert("Popup blocked. Allow popups for this file to print envelopes.");
    return;
  }
  popup.document.open();
  popup.document.write(envelopeHtml(rows, seed));
  popup.document.close();
}
