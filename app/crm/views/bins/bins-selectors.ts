/**
 * Ashley Bins' own derivation, migrated from app/crm/legacy-app.js's
 * renderBins()/binGroupCard()/binRow() (Phase 1 step 16 - CLAUDE.md),
 * eleventh of twelve views. No mobile card list here - that markup lives
 * in Batch Packet (step 15) despite its confusingly bin-themed names, a
 * real pre-existing oddity established back in step 1's own snapshot
 * work, not something this step adds or removes.
 *
 * Reused, not reimplemented, per this step's own task: binStatus/
 * groupedWork (both promoted to lib/client/selectors.ts in step 15,
 * exactly so this step wouldn't have to re-derive them),
 * componentStatus/effectiveMailings/selectedBatchDate/includesText
 * (shared since step 4).
 *
 * binRows() itself - the active/batchDate/status/Prepaid-bulk-plan/search
 * filter chain and its own character-key/letter-number/name sort - is
 * NOT shared with any other view (unlike packetRows, which Batch Packet
 * and Launch Plan both need), so it stays local here rather than moving
 * to lib/client/selectors.ts - the same "only promote what's actually
 * shared" reasoning step 7's own header comment states.
 *
 * A real, provably dead computation from legacy's own renderBins() was
 * NOT ported: it computed `characterGroups` (grouping rows by character
 * alone) but never used it anywhere in the rendered output - confirmed by
 * reading the whole function, and independently by `pnpm lint`'s own
 * pre-existing 'characterGroups' is assigned a value but never used
 * warning (now resolved by this deletion, not suppressed). Same category
 * as step 15's dropped `envelopeCount` in packetChecklist().
 */

import type { Dataset } from "@/lib/domain/dataset";
import {
  binStatus,
  componentStatus,
  effectiveMailings,
  groupedWork,
  includesText,
  selectedBatchDate,
  type BinStatus,
  type EffectiveMailing,
  type WorkGroup,
} from "@/lib/client/selectors";
import { printModeForPlan, numericLetter } from "@/lib/domain/plans";
import { driveCharacterKey } from "@/lib/domain/characters";
import { formatDate, titleCase } from "@/lib/domain/format";
import { storageBinForMailing } from "@/lib/domain/batch-dates";

export interface BinRowData {
  mailing: EffectiveMailing;
  status: BinStatus;
  bin: string;
  fieldValues: { envelope: string; letter: string; location: string };
}

export interface BinGroup extends WorkGroup<EffectiveMailing> {
  ready: number;
  needsCheck: number;
}

export interface BinsData {
  batchDate: string;
  rows: BinRowData[];
  groups: BinGroup[];
  readyCount: number;
  needsCheckCount: number;
  missingEnvelopeCount: number;
  missingLetterCount: number;
}

export function computeBinsData(
  seed: Dataset,
  statusOverrides: Record<string, string>,
  reviewed: Set<string>,
  componentOverrides: Record<string, string>,
  batchFilter: string,
  query: string,
  today: string,
): BinsData {
  const mailings = effectiveMailings(seed, statusOverrides);
  const batchDate = selectedBatchDate(batchFilter, mailings, today);
  const filteredRows = mailings
    .filter((mailing) => mailing.activeState === "Active")
    .filter((mailing) => !batchDate || mailing.shipDate === batchDate)
    .filter((mailing) => mailing.status !== "Mailed")
    .filter((mailing) => printModeForPlan(mailing.plan) === "Prepaid bulk")
    .filter((mailing) =>
      includesText([mailing.recipientName, mailing.email, mailing.character, mailing.plan, mailing.status, mailing.mailingId, mailing.orderId], query),
    )
    .sort(
      (a, b) =>
        driveCharacterKey(a.character).localeCompare(driveCharacterKey(b.character)) ||
        numericLetter(a.letterNumber) - numericLetter(b.letterNumber) ||
        String(a.recipientName).localeCompare(String(b.recipientName)),
    );

  const rows: BinRowData[] = filteredRows.map((mailing) => ({
    mailing,
    status: binStatus(mailing, seed, reviewed, componentOverrides),
    bin: storageBinForMailing(mailing),
    fieldValues: {
      envelope: componentStatus(mailing, "envelope", seed, reviewed, componentOverrides),
      letter: componentStatus(mailing, "letter", seed, reviewed, componentOverrides),
      location: componentStatus(mailing, "location", seed, reviewed, componentOverrides),
    },
  }));

  const groups: BinGroup[] = groupedWork(filteredRows, (mailing) => `${formatDate(mailing.shipDate)} Â· ${titleCase(driveCharacterKey(mailing.character))} Â· Letter ${mailing.letterNumber}`).map(
    (group) => ({
      ...group,
      ready: group.rows.filter((mailing) => binStatus(mailing, seed, reviewed, componentOverrides).label === "Ready in Ashley Bin").length,
      needsCheck: group.rows.filter((mailing) => binStatus(mailing, seed, reviewed, componentOverrides).label !== "Ready in Ashley Bin").length,
    }),
  );

  const readyCount = rows.filter((row) => row.status.label === "Ready in Ashley Bin").length;
  const needsCheckCount = rows.length - readyCount;
  const missingEnvelopeCount = rows.filter((row) => row.status.label === "Missing Envelope").length;
  const missingLetterCount = rows.filter((row) => row.status.label === "Missing Letter").length;

  return { batchDate, rows, groups, readyCount, needsCheckCount, missingEnvelopeCount, missingLetterCount };
}
