# Data recovery: ingestion_events and restoring a prior import

Every `crmDataset` import through `POST /api/shared-state` now records one
row in `ingestion_events` (`db/schema/ingestion_events.ts`) - `source`,
`occurred_at`, `raw_payload` (the complete posted dataset, as jsonb),
`status`, and `summary` (a human-readable one-liner: mailing/subscriber/
exception counts plus the source filename). The insert happens inside the
same Postgres transaction as the write itself (`app/api/shared-state/route.ts`),
so an import that rolls back never leaves behind an event claiming it
succeeded - and one that succeeds always has a corresponding row.

This is deliberately the *only* history/versioning mechanism for imports.
`raw_payload` is the complete dataset a given import wrote - not a diff,
not metadata about one - so restoring is nothing more than replaying it
through the exact same write path a real import uses
(`writeImport()`, `lib/write-to-tables.ts`).

## Why this exists

`writeImport()` deletes every subscriber/subscription/order/mailing/
exception not present in the incoming payload. Before this, a truncated
upload, a half-written file, or a malformed-but-parseable body could
silently destroy real records with no way back except the nightly
`pg_dump` (`docs/backups.md`) - up to a day of loss. `ingestion_events`
closes that gap for anything short of total database loss: every import,
good or bad, is a restore point.

## Finding an import to restore from

```bash
set -a; source .env.local; set +a
pnpm restore:import
```

With no argument, the script lists the 20 most recent imports, newest
first:

```
Recent imports (most recent first). Re-run with an id to restore from it:

  #42  2026-08-15T09:12:03.000Z  [success]  1218 mailings, 109 subscribers, 44 exceptions - Import_20260815.xlsx
  #41  2026-08-14T18:03:11.000Z  [success]  1201 mailings, 108 subscribers, 41 exceptions - Import_20260814.xlsx
  ...
```

You can also query `ingestion_events` directly (e.g. via `psql` or any
Postgres client) if you need more than the last 20, or want to inspect a
`raw_payload` before committing to a restore.

## Restoring

```bash
set -a; source .env.local; set +a
pnpm restore:import <id>
```

This runs `writeImport()` with that event's `raw_payload.seed` - the exact
same function and code path a real spreadsheet import uses - inside a
fresh transaction. Every subscriber, subscription, order, mailing, and
exception not present in that payload is removed, exactly as it would be
on a real re-import of that same data. **Restoring is itself a normal
import** and gets its own new `ingestion_events` row when done - restoring
is not exempt from being restorable-from in turn.

`devops/restore-ingestion-event.mjs` calls `writeImport()` directly, not
through `POST /api/shared-state` - it deliberately does not go through
that route's catastrophic-deletion guard
(`lib/validate-shared-state.ts`). That guard exists to catch an
*accidental* mass deletion from an unreviewed client request; a restore is
a deliberate action a human already decided to take after looking at the
event list above, so gating it the same way would just be friction with
no safety benefit.

**Verified working, not just described**: `tests/ingestion-events-restore.e2e.test.mjs`
imports dataset A, imports a disjoint dataset B, restores A via this exact
script (run as a real subprocess, not by calling its internals directly),
and asserts the tables afterward match A's own post-import state exactly.

## Retention - flagged, not solved

Every import stores a full copy of the dataset in `raw_payload`. Measured
directly against the real 1,218-row test fixture
(`testing/Import_20260812_181828.xlsx`): the stored JSON is **797,709
bytes (~779 KiB) per row**. At one import per day, that's roughly
**291 MB (277.7 MiB) per year**, growing without bound as long as nothing
ever prunes old rows - and the real dataset will only grow larger than
this fixture over time, so both numbers understate future growth.

That's not an urgent problem on its own - Postgres handles this volume
easily for years - but it is unbounded, and worth a deliberate decision
before it isn't small anymore. Recommendation, not yet implemented:

- Keep every `ingestion_events` row's `source`/`occurred_at`/`status`/
  `summary` forever - they're small (a few hundred bytes each) and are
  the audit trail of *that* an import happened, which has standalone
  value.
- Only `raw_payload` needs pruning. A reasonable cutoff: null out
  `raw_payload` (keeping the row and its summary) for events older than
  **90 days** - long enough to cover "we noticed a bad import weeks
  later," short enough to bound growth to roughly 90 days' worth of full
  payloads (~72 MB / 68.5 MiB at current size, one import/day) plus an
  ever-growing but cheap list of summaries.
- Whatever the cutoff, it should run as a scheduled job (same pattern as
  `devops/backup.sh`'s DSM Task Scheduler entry - see `docs/backups.md`),
  not something anyone has to remember to run by hand.

Deliberately not implemented here - see the task this document was
written for: "flag, don't solve." This is Brad's call to make (and when
made, `raw_payload`'s column comment in
`db/schema/ingestion_events.ts` and this doc should both be updated to
describe the real policy instead of this recommendation).
