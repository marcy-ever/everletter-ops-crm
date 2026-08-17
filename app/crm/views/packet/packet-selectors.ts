/**
 * Batch Packet's own derivation, migrated from app/crm/legacy-app.js's
 * renderPacket()/packetWorkCard()/packetChecklistCard()/packetProblemRow()/
 * packetFinalRow()/binMobileCard() (Phase 1 step 15 - CLAUDE.md), tenth of
 * twelve views and the largest snapshot in the whole suite: a print/work
 * order view covering four grouped work cards, two role checklists, a
 * held-rows table, a desktop final-mailing-rows table, AND (under
 * bin-themed names, a real, pre-existing oddity - see this step's PR) a
 * mobile card list. That mobile card's three selects are rendered here
 * (PacketMobileRow.fieldValues, below) but deliberately left inert at the
 * component level - see app/crm/views/packet/Packet.tsx's own header for
 * why: legacy never wired a change listener for them either, and this
 * step's own snapshot proof can't distinguish a wired select from an
 * unwired one, so wiring one here would have been an invisible behavior
 * change. Left for Ashley Bins (step 16) to wire for real.
 *
 * Reused, not reimplemented, from lib/client/selectors.ts (per this step's
 * own task): packetRows/packetProblemRows (shared since step 7 - Launch
 * Plan), componentStatus/exceptionsForMailing/effectiveMailings/
 * selectedBatchDate (shared since step 4), qaIsReady/qaNeedsAttention
 * (shared since step 14 - Mailing QA, used here by the final table's row
 * class exactly as legacy's packetFinalRow() used them).
 *
 * Promoted BY this step, not just reused: groupedWork() and binStatus().
 * Both were already reached into by more than one still-legacy view
 * before this step touched them (groupedWork() by Ashley Bins'
 * binGroups()/renderBins(); binStatus() by binGroups()/renderBins()/
 * binRow() too) - discovered by tracing legacy's own call graph, not
 * assumed from the "bins" naming. See lib/client/selectors.ts's own
 * header for the full story and why groupedWork() needed no state-closing
 * adapter the way binStatus()/qaIsReady()/qaNeedsAttention() did.
 *
 * groupedWork/packetEnvelopeGroups/packetLetterGroups/packetComponentGroups/
 * packetChecklist stay LOCAL here (not promoted to lib/client/selectors.ts
 * as a whole), since nothing else in the app assembles a printable work
 * order this way - only groupedWork() itself, the generic bucketing
 * primitive underneath them, turned out to be a genuine cross-view need.
 *
 * envelopePrintRows and letterFolderUrl are threaded in as explicit
 * function parameters rather than imported here, same pattern
 * app/crm/views/qa/qa-selectors.ts established: both live in
 * app/crm/legacy-app.js (exported unchanged - shared dependencies this
 * view calls, not something it owns), and importing that module directly
 * from a lib-shaped selectors file would pull in its own side-effecting
 * top-level setup for no reason. app/crm/CrmApp.tsx passes the real ones;
 * tests pass stubs.
 *
 * A real, provably dead computation from legacy's own packetChecklist()
 * was NOT ported: it computed `envelopeCount` (total envelope quantity
 * across rows) but never used it in either owner's returned checklist -
 * verified by reading every branch, not assumed. Porting it here would
 * either recompute a genuinely unused value (a lint warning waiting to
 * happen) or require awkwardly ignoring it - dropped instead, with zero
 * effect on output (this step's own snapshot proof covers exactly the
 * checklist text this file - and legacy - actually produce).
 */

import type { Dataset, DatasetMailing } from "@/lib/domain/dataset";
import {
  binStatus,
  componentStatus,
  effectiveMailings,
  exceptionsForMailing,
  groupedWork,
  packetProblemRows,
  packetRows,
  qaIsReady,
  qaNeedsAttention,
  selectedBatchDate,
  type EffectiveMailing,
  type WorkGroup,
} from "@/lib/client/selectors";
import { envelopeQuantityForMailing } from "@/lib/domain/plans";
import { driveCharacterKey, envelopeStockForCharacter } from "@/lib/domain/characters";
import { titleCase } from "@/lib/domain/format";
import { storageBinForMailing } from "@/lib/domain/batch-dates";
import { number } from "../../format";

type EnvelopePrintRows = (rows: EffectiveMailing[]) => unknown[];
type LetterFolderUrl = (mailing: DatasetMailing) => string;

function packetEnvelopeGroups(
  rows: EffectiveMailing[],
  seed: Dataset,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
): WorkGroup<EffectiveMailing>[] {
  return groupedWork(rows, (mailing) => envelopeStockForCharacter(mailing.character), envelopeQuantityForMailing).map((group) => ({
    ...group,
    remaining: group.rows
      .filter((mailing) => componentStatus(mailing, "envelope", seed, reviewed, componentOverrides) === "Need Print")
      .reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0),
  }));
}

interface LetterGroup extends WorkGroup<EffectiveMailing> {
  missingLinks: number;
}

function packetLetterGroups(
  rows: EffectiveMailing[],
  seed: Dataset,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  letterFolderUrl: LetterFolderUrl,
): LetterGroup[] {
  return groupedWork(rows, (mailing) => `${titleCase(driveCharacterKey(mailing.character))} Â· Letter ${mailing.letterNumber}`).map((group) => ({
    ...group,
    remaining: group.rows.filter((mailing) => componentStatus(mailing, "letter", seed, reviewed, componentOverrides) === "Need Print").length,
    missingLinks: group.rows.filter((mailing) => !letterFolderUrl(mailing)).length,
  }));
}

function packetComponentGroups(
  rows: EffectiveMailing[],
  field: string,
  seed: Dataset,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
): WorkGroup<EffectiveMailing>[] {
  const dueRows = rows.filter((mailing) => componentStatus(mailing, field, seed, reviewed, componentOverrides) !== "Not Needed");
  return groupedWork(dueRows, (mailing) => titleCase(driveCharacterKey(mailing.character))).map((group) => ({
    ...group,
    remaining: group.rows.filter((mailing) => ["Need Check", "Need Print", "Needs Check"].includes(componentStatus(mailing, field, seed, reviewed, componentOverrides))).length,
  }));
}

function packetChecklist(
  rows: EffectiveMailing[],
  owner: "Marcy" | "Ashley",
  seed: Dataset,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  printableEnvelopeCount: number,
  problemCount: number,
): string[] {
  const letterCount = rows.length;
  const artifactCount = rows.filter((mailing) => componentStatus(mailing, "artifact", seed, reviewed, componentOverrides) !== "Not Needed").length;
  const insertCount = rows.filter((mailing) => componentStatus(mailing, "insert", seed, reviewed, componentOverrides) !== "Not Needed").length;

  if (owner === "Marcy") {
    return [
      `Print ${number(printableEnvelopeCount)} envelopes needed now by stock/color`,
      `Print or pull ${number(letterCount)} letters by character and letter #`,
      `Resolve ${number(problemCount)} do-not-mail rows before anything leaves`,
      "Mark envelope and letter statuses in Mailing QA",
    ];
  }
  return [
    `Pack/check ${number(artifactCount)} artifact rows`,
    `Pack/check ${number(insertCount)} map or insert rows`,
    "Move finished pieces into the correct dated bin",
    "Final scan: every mailed row must be QA Ready",
  ];
}

export interface PacketProblemRow {
  mailing: EffectiveMailing;
  reasons: string[];
}

function buildProblemReasons(mailing: EffectiveMailing, seed: Dataset, reviewed: Set<string>, componentOverrides: Record<string, string>): string[] {
  const issues = exceptionsForMailing(mailing, seed, reviewed);
  return [
    ...issues.map((item) => item.reason),
    componentStatus(mailing, "payment", seed, reviewed, componentOverrides) !== "Active" ? `Payment: ${componentStatus(mailing, "payment", seed, reviewed, componentOverrides)}` : "",
    componentStatus(mailing, "qa", seed, reviewed, componentOverrides) === "Problem" ? "QA marked Problem" : "",
    !mailing.shipDate ? "Missing ship date" : "",
  ].filter(Boolean);
}

export interface PacketFinalRow {
  mailing: EffectiveMailing;
  envelopeQuantity: number;
  isReady: boolean;
  needsAttention: boolean;
  fieldValues: { envelope: string; letter: string; artifact: string; insert: string; qa: string };
}

function buildFinalRow(mailing: EffectiveMailing, seed: Dataset, reviewed: Set<string>, componentOverrides: Record<string, string>): PacketFinalRow {
  return {
    mailing,
    envelopeQuantity: envelopeQuantityForMailing(mailing),
    isReady: qaIsReady(mailing, seed, reviewed, componentOverrides),
    needsAttention: qaNeedsAttention(mailing, seed, reviewed, componentOverrides),
    fieldValues: {
      envelope: componentStatus(mailing, "envelope", seed, reviewed, componentOverrides),
      letter: componentStatus(mailing, "letter", seed, reviewed, componentOverrides),
      artifact: componentStatus(mailing, "artifact", seed, reviewed, componentOverrides),
      insert: componentStatus(mailing, "insert", seed, reviewed, componentOverrides),
      qa: componentStatus(mailing, "qa", seed, reviewed, componentOverrides),
    },
  };
}

// Mirrors legacy's binMobileCard() exactly, including its own header's
// mojibake separator (" Â· " - see app/globals.css/CLAUDE.md's Known
// Issues on this repo's existing mojibake, left untouched by this step
// per its own "no behavior change" scope) - reproduced verbatim, not
// "fixed," since a fixed spelling would fail this step's own
// byte-normalized equivalence proof against the frozen snapshot.
export interface PacketMobileRow {
  mailing: EffectiveMailing;
  bin: string;
  status: { label: string; detail: string };
  fieldValues: { envelope: string; letter: string; location: string };
}

function buildMobileRow(mailing: EffectiveMailing, seed: Dataset, reviewed: Set<string>, componentOverrides: Record<string, string>): PacketMobileRow {
  return {
    mailing,
    bin: storageBinForMailing(mailing),
    status: binStatus(mailing, seed, reviewed, componentOverrides),
    fieldValues: {
      envelope: componentStatus(mailing, "envelope", seed, reviewed, componentOverrides),
      letter: componentStatus(mailing, "letter", seed, reviewed, componentOverrides),
      location: componentStatus(mailing, "location", seed, reviewed, componentOverrides),
    },
  };
}

export interface PacketData {
  batchDate: string;
  rows: EffectiveMailing[];
  finalRows: PacketFinalRow[];
  mobileRows: PacketMobileRow[];
  problemRows: PacketProblemRow[];
  envelopeCount: number;
  printableEnvelopeCount: number;
  envelopeGroups: WorkGroup<EffectiveMailing>[];
  letterGroups: LetterGroup[];
  artifactGroups: WorkGroup<EffectiveMailing>[];
  insertGroups: WorkGroup<EffectiveMailing>[];
  marcyChecklist: string[];
  ashleyChecklist: string[];
}

export function computePacketData(
  seed: Dataset,
  statusOverrides: Record<string, string>,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  batchFilter: string,
  packetScope: string,
  query: string,
  today: string,
  letterFolderUrl: LetterFolderUrl,
  envelopePrintRows: EnvelopePrintRows,
): PacketData {
  const mailings = effectiveMailings(seed, statusOverrides);
  const batchDate = selectedBatchDate(batchFilter, mailings, today);
  const rows = packetRows(mailings, batchDate, packetScope, query);
  const problemRows = packetProblemRows(rows, seed, reviewed, componentOverrides);
  const envelopeCount = rows.reduce((total, mailing) => total + envelopeQuantityForMailing(mailing), 0);
  const printableEnvelopeCount = envelopePrintRows(rows).length;

  return {
    batchDate,
    rows,
    finalRows: rows.map((mailing) => buildFinalRow(mailing, seed, reviewed, componentOverrides)),
    mobileRows: rows.map((mailing) => buildMobileRow(mailing, seed, reviewed, componentOverrides)),
    problemRows: problemRows.map((mailing) => ({ mailing, reasons: buildProblemReasons(mailing, seed, reviewed, componentOverrides) })),
    envelopeCount,
    printableEnvelopeCount,
    envelopeGroups: packetEnvelopeGroups(rows, seed, reviewed, componentOverrides),
    letterGroups: packetLetterGroups(rows, seed, reviewed, componentOverrides, letterFolderUrl),
    artifactGroups: packetComponentGroups(rows, "artifact", seed, reviewed, componentOverrides),
    insertGroups: packetComponentGroups(rows, "insert", seed, reviewed, componentOverrides),
    marcyChecklist: packetChecklist(rows, "Marcy", seed, reviewed, componentOverrides, printableEnvelopeCount, problemRows.length),
    ashleyChecklist: packetChecklist(rows, "Ashley", seed, reviewed, componentOverrides, printableEnvelopeCount, problemRows.length),
  };
}
