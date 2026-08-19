#!/usr/bin/env node
// Restores the normalized tables to the exact state a prior crmDataset
// import left them in, using nothing but that import's own
// ingestion_events row - see docs/data-recovery.md for the full
// explanation and a worked example. This is the whole rollback
// mechanism: no separate history/versioning machinery exists or is
// needed, because ingestion_events.raw_payload already holds the
// complete dataset every import wrote, and writeImport() is the same
// function POST /api/shared-state uses for a real import - running it
// again with an old payload IS the restore.
//
// Usage (see package.json's "restore:import" script for the wrapped
// form):
//   node --experimental-strip-types \
//     --experimental-loader=./tests/ts-extensionless-loader.mjs \
//     devops/restore-ingestion-event.mjs                 # list recent imports
//   node --experimental-strip-types \
//     --experimental-loader=./tests/ts-extensionless-loader.mjs \
//     devops/restore-ingestion-event.mjs <ingestion_events.id>  # restore one
//
// Requires DATABASE_URL in the environment (source .env.local first, same
// as every other DATABASE_URL-dependent command in this repo - see
// CLAUDE.md SS6). Deliberately calls writeImport() directly rather than
// going through POST /api/shared-state's HTTP layer: this is a
// server-side administrative action run by a human who has already
// decided to restore, not a client request that needs the
// catastrophic-deletion guard (lib/validate-shared-state.ts) standing in
// its way - that guard exists to catch an *accidental* mass deletion,
// and a deliberate restore is the opposite of accidental.
import { desc, eq } from "drizzle-orm";

async function main() {
  const idArg = process.argv[2];

  const { getDb } = await import("../db/index");
  const { ingestionEvents } = await import("../db/schema/ingestion_events");
  const { writeImport } = await import("../lib/write-to-tables");

  const db = getDb();

  if (!idArg) {
    const recent = await db
      .select({ id: ingestionEvents.id, occurredAt: ingestionEvents.occurredAt, source: ingestionEvents.source, status: ingestionEvents.status, summary: ingestionEvents.summary })
      .from(ingestionEvents)
      .orderBy(desc(ingestionEvents.id))
      .limit(20);
    if (!recent.length) {
      console.log("No ingestion_events rows exist yet - nothing to restore from.");
      return;
    }
    console.log("Recent imports (most recent first). Re-run with an id to restore from it:\n");
    for (const row of recent) {
      console.log(`  #${row.id}  ${row.occurredAt.toISOString()}  [${row.source}/${row.status}]  ${row.summary}`);
    }
    return;
  }

  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) {
    console.error(`"${idArg}" is not a valid ingestion_events id.`);
    process.exitCode = 1;
    return;
  }

  const rows = await db.select().from(ingestionEvents).where(eq(ingestionEvents.id, id));
  if (rows.length !== 1) {
    console.error(`No ingestion_events row with id ${id}.`);
    process.exitCode = 1;
    return;
  }
  const event = rows[0];
  if (!event.rawPayload || typeof event.rawPayload !== "object" || !("seed" in event.rawPayload)) {
    console.error(`ingestion_events row ${id} has no usable raw_payload.seed - cannot restore from it.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Restoring from ingestion_events #${id} (${event.occurredAt.toISOString()}, ${event.summary})...`);
  const seed = event.rawPayload.seed;
  const summary = `Restored from ingestion_events #${id} (${event.summary})`;
  await db.transaction(async (tx) => {
    // writeImport()'s return value (lib/write-to-tables.ts's
    // ImportSummary) is real here too - a restore runs the exact same
    // skip logic a live import does (unrecognized plans, ambiguous ids,
    // etc. are properties of the seed being written, not of how it got
    // here), so the new row this restore creates gets its own accurate
    // `skipped` value, not a copy of the original import's.
    const importSummary = await writeImport(seed, tx);
    // Same transaction as the write, for the same reason every crmDataset
    // import does this (app/api/shared-state/route.ts): an event
    // recording a restore that rolled back would be worse than no event.
    // source: "restore" (not "manual_spreadsheet") so the history reads
    // correctly - a restore is a distinct, traceable kind of import, not
    // indistinguishable from a real reimport of the spreadsheet.
    await tx.insert(ingestionEvents).values({
      source: "restore",
      rawPayload: event.rawPayload,
      status: "success",
      summary,
      skipped: importSummary.skipped,
    });
  });
  console.log(`Restored. Tables now match ingestion_events #${id}'s import exactly. This restore itself is now an ingestion_events row - it's restorable-from in turn, same as any other import.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
