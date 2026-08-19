# Data recovery: ingestion_events and restoring a prior import

Every `crmDataset` import through `POST /api/shared-state` now records one
row in `ingestion_events` (`db/schema/ingestion_events.ts`) - `source`,
`occurred_at`, `raw_payload` (the complete posted dataset, as jsonb),
`status`, `summary` (a human-readable one-liner: mailing/subscriber/
exception counts plus the source filename), and `skipped` (structured -
which rows `writeImport()` didn't write and why, grouped by reason with
real spreadsheet row numbers; see `lib/write-to-tables.ts`'s
`ImportSummary` and the Import Sheet view's own reconciliation panel,
which renders this same data right after a publish). The insert happens
inside the same Postgres transaction as the write itself
(`app/api/shared-state/route.ts`), so an import that rolls back never
leaves behind an event claiming it succeeded - and one that succeeds
always has a corresponding row.

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

  #43  2026-08-16T08:02:11.000Z  [restore/success]  Restored from ingestion_events #41 (1201 mailings, 108 subscribers, 41 exceptions - Import_20260814.xlsx)
  #42  2026-08-15T09:12:03.000Z  [manual_spreadsheet/success]  1218 mailings, 109 subscribers, 44 exceptions - Import_20260815.xlsx
  #41  2026-08-14T18:03:11.000Z  [manual_spreadsheet/success]  1201 mailings, 108 subscribers, 41 exceptions - Import_20260814.xlsx
  ...
```

`source` (the first half of the bracketed pair) distinguishes a real
spreadsheet import (`manual_spreadsheet`) from a restore
(`restore` - see "Restoring" below) at a glance, without having to read
into `summary`.

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
  value. `skipped` (added alongside the reconciliation panel - see
  `db/schema/ingestion_events.ts`'s own comment) is small per row too - a
  handful of reasons and row numbers, not a full dataset - but hasn't been
  measured at real scale the way `raw_payload` has below; worth doing
  before treating it as automatically safe to keep forever the same way.
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

## `audit_events`: retention - flagged, not solved (same treatment as above)

`audit_events` (`db/schema/audit_events.ts`) is the per-change complement to
`ingestion_events` above - one row per `mailingStatus`/`componentStatus`/
`reviewedException` write plus one per `crmDataset` import (written inside
the same transaction as each, by `app/api/shared-state/route.ts`'s POST
handler; read back via `GET /api/audit`). Completely different shape and
cardinality from `ingestion_events`: no `raw_payload` jsonb blob, just a
handful of short text columns (`actor_email`, `kind`, `item_key`,
`previous_value`, `new_value`) - but a change happens far more often than an
import, so it's worth measuring on its own terms rather than assuming
"smaller row" means "not worth flagging."

**Measured directly**, not estimated: four representative rows (one of each
`kind`, using realistic values - a full-length `mailingId::sourceRow`
component key, an `exceptionReviewKey` with a long real reason string, a
real-shaped import summary) inserted into a local table and measured with
Postgres's own `pg_column_size()`:

| kind | bytes (row payload) |
| --- | --- |
| `mailingStatus` | 132 |
| `componentStatus` | 150 |
| `reviewedException` | 200 (longest - `exceptionReviewKey` carries a full reason string) |
| `crmDataset` | 166 |

Average **162 bytes/row** of actual column data; call it **~200 bytes/row**
all-in once the ~24-byte heap tuple header, line pointer, and
`audit_events_occurred_at_idx` index entry are counted - a deliberately
rounded-up envelope, not a precise figure.

**Projected growth** at a realistic change volume, not a worst case: this
app processes roughly 1,200 mailings across the two mailing-day batches
(1st/15th) per month (matching the real ~1,218-row test fixture). Estimating
~1 `mailingStatus` write plus ~3 `componentStatus` writes per mailing per
cycle (envelope, letter, and QA status are the fields that change most),
plus a modest number of `reviewedException` dismissals and one `crmDataset`
import/day (same daily-import assumption `ingestion_events`'s own estimate
above uses):

- ~1,200 mailings x 4 writes = ~4,800 rows/month from status activity
- ~30 rows/month from reviewed-exception dismissals (rough)
- ~30 rows/month from daily imports
- **~4,860 rows/month, ~58,000 rows/year**

At ~200 bytes/row all-in: **~11.6 MB/year** - even a full order of
magnitude heavier than this estimate (a much busier bulk-action cadence
than observed so far) stays under ~120 MB/year, well under
`ingestion_events`'s own ~292 MB/year projection (which stores full dataset
payloads, not short text fields - a different kind of growth entirely).

Not an urgent problem - Postgres handles tens of thousands of rows a year
trivially - but it's unbounded in the same way `ingestion_events` is, and
belongs in the same eventual decision rather than a separate one.
Recommendation, not yet implemented, mirroring the same shape as above:

- Keep every `audit_events` row forever, as-is - unlike `ingestion_events`,
  there's no large field to selectively prune (`previous_value`/`new_value`
  are always short, bounded strings, never a full payload). If a policy is
  ever needed, it's a row-age cutoff (delete, not null-out a column), not a
  partial-prune.
- Given the growth estimate above, that cutoff isn't urgent - flagged here
  so the decision isn't made by default via "nobody thought about it,"
  matching how `ingestion_events`'s own retention question was raised
  before it became large enough to matter.
